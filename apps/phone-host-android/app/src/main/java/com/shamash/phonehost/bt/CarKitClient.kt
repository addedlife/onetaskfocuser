package com.shamash.phonehost.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.shamash.phonehost.CallDirection
import com.shamash.phonehost.CallInfo
import com.shamash.phonehost.CallStatus
import com.shamash.phonehost.HostLog
import org.json.JSONObject

/**
 * Car-kit lane — the exact path an Android car kit uses for calls WITH audio:
 * the platform HFP hands-free profile (`BluetoothHeadsetClient`, profile id 16).
 * When the platform stack holds HFP, SCO call audio is routed by the Bluetooth
 * stack itself — the tablet's speaker and mic become the call's speakerphone,
 * which the raw app-level RFCOMM lane (HfpClient) can never do (SCO links are
 * not reachable from app code).
 *
 * The catch: `BluetoothHeadsetClient` is a @SystemApi. Consumer builds usually
 * ship with the HF-client profile disabled (`profile_supported_hfpclient=false`)
 * and its methods behind BLUETOOTH_PRIVILEGED. This client therefore does
 * everything by reflection, PROBES for availability instead of assuming it,
 * and reports an honest "not supported on this build" when the platform says
 * no — the web UI shows that instead of a silent dead toggle.
 *
 * Mutual exclusion: the phone accepts one HFP client per device, so while the
 * car-kit lane is engaged the raw HfpClient must stay parked (HostService
 * gates connectTo on carKitMode) — MAP/PBAP/MNS keep running unchanged.
 */
@SuppressLint("MissingPermission", "PrivateApi")
class CarKitClient(private val log: (String) -> Unit = { HostLog.add(it) }) {

    companion object {
        // BluetoothProfile.HEADSET_CLIENT — hidden constant, stable in AOSP.
        const val PROFILE_HEADSET_CLIENT = 16

        // Hidden broadcast actions (string literals — stable in AOSP since 4.4).
        private const val ACTION_CONNECTION_STATE_CHANGED =
            "android.bluetooth.headsetclient.profile.action.CONNECTION_STATE_CHANGED"
        private const val ACTION_AUDIO_STATE_CHANGED =
            "android.bluetooth.headsetclient.profile.action.AUDIO_STATE_CHANGED"
        private const val ACTION_CALL_CHANGED =
            "android.bluetooth.headsetclient.profile.action.AG_CALL_CHANGED"
        private const val EXTRA_CALL = "android.bluetooth.headsetclient.extra.CALL"

        // BluetoothHeadsetClientCall.getState() values.
        private const val CALL_STATE_ACTIVE = 0
        private const val CALL_STATE_DIALING = 2
        private const val CALL_STATE_ALERTING = 3
        private const val CALL_STATE_INCOMING = 4
        private const val CALL_STATE_WAITING = 5
        private const val CALL_STATE_TERMINATED = 7
    }

    /** null = probe not run yet; false = platform said no; true = proxy live. */
    @Volatile var supported: Boolean? = null
        private set
    @Volatile var engaged = false
        private set
    @Volatile var audioConnected = false
        private set
    @Volatile var lastError: String? = null
        private set
    @Volatile var currentCall = CallInfo()
        private set

    var onCallStateChanged: ((CallInfo) -> Unit)? = null
    var onStatus: ((String) -> Unit)? = null

    private var proxy: BluetoothProfile? = null
    private var receiver: BroadcastReceiver? = null
    private var appContext: Context? = null
    @Volatile private var deviceAddress: String = ""

    // ── Probe + register ──────────────────────────────────────────────────
    /** Ask the platform for the HEADSET_CLIENT proxy. Cheap and safe to call at
     *  service start; resolves `supported` asynchronously. */
    fun probe(context: Context, adapter: BluetoothAdapter?) {
        appContext = context.applicationContext
        if (adapter == null) { supported = false; lastError = "Bluetooth adapter unavailable"; return }
        registerReceiver(context.applicationContext)
        try {
            val requested = adapter.getProfileProxy(
                context.applicationContext,
                object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, p: BluetoothProfile) {
                        if (profile != PROFILE_HEADSET_CLIENT) return
                        proxy = p
                        supported = true
                        lastError = null
                        log("[CARKIT] platform HFP-client proxy acquired (${p.javaClass.simpleName})")
                        onStatus?.invoke("Car-kit profile available")
                    }
                    override fun onServiceDisconnected(profile: Int) {
                        if (profile != PROFILE_HEADSET_CLIENT) return
                        proxy = null
                        engaged = false
                        audioConnected = false
                        log("[CARKIT] platform HFP-client proxy lost")
                        onStatus?.invoke("Car-kit profile lost")
                    }
                },
                PROFILE_HEADSET_CLIENT,
            )
            if (!requested) {
                supported = false
                lastError = "HFP-client profile not offered by this Android build"
                log("[CARKIT] getProfileProxy(HEADSET_CLIENT) refused — profile disabled on this build")
            }
        } catch (ex: Exception) {
            supported = false
            lastError = "probe failed: ${ex.message}"
            log("[CARKIT] probe failed: ${ex.message}")
        }
    }

    // ── Engage / disengage ────────────────────────────────────────────────
    /** Connect the platform HFP-client profile to the phone (call signaling +
     *  stack-routed SCO call audio). Throws nothing; check lastError. */
    fun engage(device: BluetoothDevice): Boolean {
        val p = proxy ?: run {
            lastError = if (supported == false) (lastError ?: "not supported on this build")
                        else "car-kit profile proxy not ready yet"
            return false
        }
        return try {
            deviceAddress = device.address
            val okConnect = call(p, "connect", device) as? Boolean ?: false
            if (!okConnect) {
                lastError = "platform refused HFP-client connect (privileged on this build?)"
                log("[CARKIT] connect(${device.address}) refused")
                false
            } else {
                engaged = true
                lastError = null
                log("[CARKIT] engaging — platform HFP connect requested")
                onStatus?.invoke("Car kit connecting…")
                true
            }
        } catch (ex: Exception) {
            lastError = "connect failed: ${ex.message}"
            log("[CARKIT] connect failed: ${ex.message}")
            false
        }
    }

    fun disengage() {
        val p = proxy ?: return
        val d = device() ?: return
        runCatching { call(p, "disconnectAudio", d) }
        runCatching { call(p, "disconnect", d) }
        engaged = false
        audioConnected = false
        if (currentCall.status != CallStatus.Idle) {
            currentCall = CallInfo()
            onCallStateChanged?.invoke(currentCall.copy())
        }
        log("[CARKIT] disengaged")
        onStatus?.invoke("Car kit off")
    }

    /** Route/unroute SCO call audio through this device (like tapping the
     *  "audio to car" button on a head unit). */
    fun setAudioRoute(on: Boolean): Boolean {
        val p = proxy ?: return false
        val d = device() ?: return false
        return try {
            val ok = call(p, if (on) "connectAudio" else "disconnectAudio", d) as? Boolean ?: false
            if (!ok) lastError = "platform refused ${if (on) "connectAudio" else "disconnectAudio"}"
            ok
        } catch (ex: Exception) {
            lastError = "audio route failed: ${ex.message}"
            false
        }
    }

    // ── Call control (mirrors HfpClient's surface) ────────────────────────
    fun answer() {
        val p = proxy ?: return
        val d = device() ?: return
        // acceptCall(BluetoothDevice, int flag) — 0 = CALL_ACCEPT_NONE
        runCatching { p.javaClass.getMethod("acceptCall", BluetoothDevice::class.java, Int::class.javaPrimitiveType)
            .invoke(p, d, 0) }
            .onFailure { log("[CARKIT] acceptCall failed: ${it.message}") }
    }

    fun hangUp() {
        val p = proxy ?: return
        val d = device() ?: return
        val terminated = runCatching {
            // terminateCall(BluetoothDevice, BluetoothHeadsetClientCall?) — null = the current call
            val callClass = Class.forName("android.bluetooth.BluetoothHeadsetClientCall")
            p.javaClass.getMethod("terminateCall", BluetoothDevice::class.java, callClass).invoke(p, d, null)
        }.isSuccess
        if (!terminated) runCatching { call(p, "rejectCall", d) }
            .onFailure { log("[CARKIT] hangup failed: ${it.message}") }
    }

    fun dial(number: String) {
        val p = proxy ?: return
        val d = device() ?: return
        runCatching { p.javaClass.getMethod("dial", BluetoothDevice::class.java, String::class.java).invoke(p, d, number) }
            .onFailure { log("[CARKIT] dial failed: ${it.message}") }
    }

    // ── Status ────────────────────────────────────────────────────────────
    fun statusJson(): JSONObject = JSONObject()
        .put("supported", supported ?: JSONObject.NULL)
        .put("engaged", engaged)
        .put("audioConnected", audioConnected)
        .put("device", deviceAddress.ifBlank { JSONObject.NULL })
        .put("error", lastError ?: JSONObject.NULL)

    // ── Internals ─────────────────────────────────────────────────────────
    private fun device(): BluetoothDevice? {
        if (deviceAddress.isBlank()) return null
        return runCatching {
            (appContext?.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)
                ?.adapter?.getRemoteDevice(deviceAddress)
        }.getOrNull()
    }

    private fun call(target: Any, method: String, device: BluetoothDevice): Any? =
        target.javaClass.getMethod(method, BluetoothDevice::class.java).invoke(target, device)

    private fun registerReceiver(context: Context) {
        if (receiver != null) return
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                when (intent.action) {
                    ACTION_CONNECTION_STATE_CHANGED -> {
                        val state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1)
                        engaged = state == BluetoothProfile.STATE_CONNECTED
                        log("[CARKIT] connection state → $state")
                        onStatus?.invoke(if (engaged) "Car kit connected" else "Car kit link down")
                        if (!engaged) {
                            audioConnected = false
                            if (currentCall.status != CallStatus.Idle) {
                                currentCall = CallInfo()
                                onCallStateChanged?.invoke(currentCall.copy())
                            }
                        }
                    }
                    ACTION_AUDIO_STATE_CHANGED -> {
                        val state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1)
                        audioConnected = state == 2 // STATE_AUDIO_CONNECTED
                        log("[CARKIT] audio state → $state")
                    }
                    ACTION_CALL_CHANGED -> handleCallChanged(intent)
                }
            }
        }
        try {
            val filter = IntentFilter().apply {
                addAction(ACTION_CONNECTION_STATE_CHANGED)
                addAction(ACTION_AUDIO_STATE_CHANGED)
                addAction(ACTION_CALL_CHANGED)
            }
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
            } else {
                @Suppress("UnspecifiedRegisterReceiverFlag")
                context.registerReceiver(r, filter)
            }
            receiver = r
        } catch (ex: Exception) {
            log("[CARKIT] receiver registration failed: ${ex.message}")
        }
    }

    /** AG_CALL_CHANGED carries a BluetoothHeadsetClientCall parcelable — read
     *  its state/number by reflection and map onto the shared CallInfo model. */
    private fun handleCallChanged(intent: Intent) {
        val parcel = intent.getParcelableExtra<android.os.Parcelable>(EXTRA_CALL) ?: return
        val state = runCatching { parcel.javaClass.getMethod("getState").invoke(parcel) as Int }.getOrNull() ?: return
        val number = runCatching { parcel.javaClass.getMethod("getNumber").invoke(parcel) as? String }.getOrNull() ?: ""
        val outgoing = runCatching { parcel.javaClass.getMethod("isOutgoing").invoke(parcel) as? Boolean }.getOrNull()
        log("[CARKIT] call state → $state ($number)")
        val prev = currentCall
        currentCall = when (state) {
            CALL_STATE_INCOMING, CALL_STATE_WAITING ->
                CallInfo(CallStatus.IncomingRinging, CallDirection.Incoming, number)
            CALL_STATE_DIALING, CALL_STATE_ALERTING ->
                CallInfo(CallStatus.Dialing, CallDirection.Outgoing, number)
            CALL_STATE_ACTIVE -> CallInfo(
                CallStatus.Active,
                // The stack tells us outgoing-ness directly — no CIEV ordering games,
                // an answered call can never be misfiled as Missed on this lane.
                if (outgoing == true || prev.direction == CallDirection.Outgoing) CallDirection.Outgoing else CallDirection.Incoming,
                number.ifBlank { prev.number },
                null,
                if (prev.status == CallStatus.Active) prev.startTime else System.currentTimeMillis(),
            )
            CALL_STATE_TERMINATED -> CallInfo(
                CallStatus.Idle,
                when {
                    prev.status == CallStatus.Active -> prev.direction
                    prev.direction == CallDirection.Outgoing -> CallDirection.Outgoing
                    prev.status == CallStatus.IncomingRinging -> CallDirection.Missed
                    else -> prev.direction
                },
                number.ifBlank { prev.number },
                null,
                prev.startTime,
            )
            else -> return
        }
        onCallStateChanged?.invoke(currentCall.copy())
    }
}
