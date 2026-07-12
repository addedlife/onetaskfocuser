package com.shamash.phonehost

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.IBinder
import com.shamash.phonehost.api.ApiJson
import com.shamash.phonehost.api.HostAuth
import com.shamash.phonehost.api.LocalApiServer
import com.shamash.phonehost.bt.HfpClient
import com.shamash.phonehost.bt.MapClient
import com.shamash.phonehost.bt.MnsServer
import com.shamash.phonehost.bt.PbapClient
import com.shamash.phonehost.store.CallLogStore
import com.shamash.phonehost.store.ContactStore
import com.shamash.phonehost.store.MessageStore
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The Android local Bluetooth phone host.
 *
 * Foreground service that owns the whole stack:
 *   HFP  → live call state + answer/hangup/dial
 *   MAP  → message sync + send (delta sync + MNS push)
 *   PBAP → call history + phonebook import
 *   HTTP → the Shamash host control API on :8765 (same contract as Windows)
 *   NSD  → advertises _shamash-phonehost._tcp on the LAN so other devices
 *          (the iPad lane) can discover the active host without the cloud relay.
 *
 * Seamless switching: the phone accepts only one MAP/HFP client at a time, so
 * hosts hand the link over — POST /handoff-release makes this host drop the
 * Bluetooth link cleanly so another host's /connect can take it.
 */
@SuppressLint("MissingPermission")
class HostService : Service() {

    companion object {
        // Single bump point: hostBuild in app/build.gradle.kts (drives this,
        // versionCode/Name, the launcher label, and the icon color).
        val BUILD_STAMP = "android-b${BuildConfig.HOST_BUILD}"
        private const val CHANNEL_ID = "phonehost"
        private const val NOTIFICATION_ID = 1

        @Volatile
        var instance: HostService? = null
    }

    private lateinit var messageStore: MessageStore
    private lateinit var callLogStore: CallLogStore
    private lateinit var contactStore: ContactStore

    private val map = MapClient()
    private val hfp = HfpClient()
    private val pbap = PbapClient()
    private var mns: MnsServer? = null
    private val api = LocalApiServer()

    private val executor = Executors.newScheduledThreadPool(4)
    private val connecting = AtomicBoolean(false)
    private val sending = AtomicBoolean(false)
    private val historyLoading = AtomicBoolean(false)
    @Volatile private var realOpActive = false
    @Volatile private var statusHfp = "Idle"
    @Volatile private var statusMap = "Idle"
    @Volatile private var lastPbapImportAt = 0L
    @Volatile private var released = false // /handoff-release parks the host

    private var nsdManager: NsdManager? = null
    private var nsdListener: NsdManager.RegistrationListener? = null

    private val prefs by lazy { getSharedPreferences("phonehost", Context.MODE_PRIVATE) }
    val hostAuth by lazy { HostAuth(prefs) { HostLog.add(it) } }
    private val relay = RelayClient(this)

    private val adapter: BluetoothAdapter?
        get() = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    var defaultDeviceAddress: String
        get() = prefs.getString("defaultDevice", "") ?: ""
        set(value) { prefs.edit().putString("defaultDevice", value).apply() }

    // ── Lifecycle ─────────────────────────────────────────────────────────
    override fun onCreate() {
        super.onCreate()
        instance = this
        messageStore = MessageStore(this)
        callLogStore = CallLogStore(this)
        contactStore = ContactStore(this)

        // On Android 12+ a connectedDevice foreground service may only start when
        // Bluetooth permission is granted; without it startForeground throws and
        // the service would crash-loop. Callers guard too — this is the backstop.
        try {
            startForeground(NOTIFICATION_ID, buildNotification("Starting…"))
        } catch (ex: Exception) {
            HostLog.add("[HOST] Cannot start: Bluetooth permission missing (${ex.message})")
            stopSelf()
            return
        }

        map.onStatus = { statusMap = it }
        wireHfp()
        wireApi()
        api.start()
        registerNsd()
        relay.start()

        // NOTE: every periodic body is wrapped in runCatching — a single thrown
        // exception permanently cancels a scheduled task, which would silently
        // kill the watchdog/sync forever.

        // Store flusher (debounced saves)
        executor.scheduleWithFixedDelay({
            runCatching {
                messageStore.flushIfDirty()
                callLogStore.flushIfDirty()
                contactStore.flushIfDirty()
            }
        }, 5, 5, TimeUnit.SECONDS)

        // Delta-sync poll (MNS push is primary; this is the safety net)
        executor.scheduleWithFixedDelay({
            runCatching {
                if (map.isConnected && !realOpActive) {
                    val newMsgs = map.performDeltaSync()
                    if (newMsgs.isNotEmpty()) {
                        val added = messageStore.merge(newMsgs)
                        if (added > 0) HostLog.add("[SYNC] +$added messages")
                    }
                }
            }.onFailure { HostLog.add("[SYNC] delta failed: ${it.message}") }
        }, 20, 30, TimeUnit.SECONDS)

        // Reconnect watchdog
        executor.scheduleWithFixedDelay({
            runCatching {
                // Gate on arbitration: while the PC is the chosen/live host, this
                // tablet stays parked instead of yanking the phone back (no swamp).
                if (!released && !isFullyConnected() && !connecting.get() && defaultDeviceAddress.isNotBlank() && relay.shouldHoldPhone()) {
                    HostLog.add("[WATCHDOG] link down — auto-reconnect")
                    connectToDefault()
                }
            }
        }, 30, 30, TimeUnit.SECONDS)

        // PBAP refresh: hourly call-log/contact import while connected
        executor.scheduleWithFixedDelay({
            runCatching {
                if (isFullyConnected() && System.currentTimeMillis() - lastPbapImportAt > 60 * 60_000) {
                    runPbapImport()
                }
            }
        }, 5, 10, TimeUnit.MINUTES)

        HostLog.add("[HOST] Service created — API ${api.startupResult}")

        if (defaultDeviceAddress.isNotBlank()) {
            // Arbitration: learn (off the main thread) whether the PC is the chosen
            // host before grabbing, so a tablet reboot while the PC holds doesn't start
            // a tug-of-war. Default is tablet-primary, so this normally connects.
            executor.execute {
                runCatching { relay.evaluateShouldHold() }
                if (relay.shouldHoldPhone()) connectToDefault()
                else HostLog.add("[HOST] PC is the chosen phone host (owner doc) — standing by")
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        instance = null
        unregisterNsd()
        relay.stop()
        api.stop()
        mns?.stop()
        // Bluetooth teardown does blocking socket I/O — never on the main thread
        // (OBEX round-trips under the sync lock can stall long enough to ANR).
        Thread {
            runCatching { map.disconnect() }
            runCatching { hfp.disconnect() }
        }.apply { isDaemon = true }.start()
        executor.shutdownNow()
        messageStore.flushIfDirty()
        callLogStore.flushIfDirty()
        contactStore.flushIfDirty()
        super.onDestroy()
    }

    // ── Connection orchestration ──────────────────────────────────────────
    fun isFullyConnected(): Boolean = map.isConnected && hfp.isConnected

    fun isBusyConnecting(): Boolean = connecting.get()

    /** Any non-idle call (ringing, dialing, active) — a handoff release must wait. */
    fun isCallActive(): Boolean = hfp.currentCall.status != CallStatus.Idle

    fun isPaused(): Boolean = released

    /** Human name for a paired device, for consumer-facing UI. */
    fun deviceName(address: String): String? = try {
        adapter?.bondedDevices?.firstOrNull { it.address == address }?.name
    } catch (_: Exception) { null }

    private fun defaultDeviceLabel(): String = deviceName(defaultDeviceAddress) ?: "your phone"

    fun connectToDefault() {
        val address = defaultDeviceAddress
        if (address.isBlank()) { HostLog.add("[HOST] No default device saved"); return }
        connectTo(address)
    }

    fun connectTo(address: String) {
        if (!connecting.compareAndSet(false, true)) return
        released = false
        executor.execute {
            try {
                val device = adapter?.getRemoteDevice(address)
                    ?: throw IllegalStateException("Bluetooth adapter unavailable")
                val label = device.name ?: "your phone"
                updateNotification("Connecting to $label…")

                // HFP first (fast), then MAP (retry ladder), then MNS + seed + sync.
                try {
                    if (!hfp.isConnected) hfp.connect(device)
                } catch (ex: Exception) {
                    statusHfp = "HFP failed: ${ex.message}"
                    HostLog.add("[HOST] HFP connect failed: ${ex.message}")
                }

                if (!map.isConnected) {
                    map.connect(device)
                    map.seedKnownHandles(messageStore.knownHandles())
                    // MNS is created lazily: at service start Bluetooth may still be
                    // off, and a null adapter then must not cost us live push forever.
                    if (mns == null) wireMns()
                    mns?.start()
                    map.registerForNotifications(true)
                    val newMsgs = map.performDeltaSync()
                    val added = messageStore.merge(newMsgs)
                    HostLog.add("[HOST] Initial sync merged $added messages")
                    startHistoryLoad()
                }

                if (System.currentTimeMillis() - lastPbapImportAt > 10 * 60_000) runPbapImport()

                defaultDeviceAddress = address
                updateNotification(
                    if (isFullyConnected()) "Connected to $label"
                    else "Connected to $label (messages only)",
                )
            } catch (ex: Exception) {
                HostLog.add("[HOST] Connect failed: ${ex.message}")
                updateNotification("Can't reach your phone — will keep trying")
            } finally {
                connecting.set(false)
            }
        }
    }

    /** Last arbitration verdict: true means the OTHER host (the PC) is the live
     *  preferred holder — connecting from here is a takeover, not a retry. */
    fun otherHostHoldsPhone(): Boolean = !relay.shouldHoldPhone()

    /** Explicit takeover (user confirmed in the UI): claim `preferred=tablet` on the
     *  owner doc — the PC releases the Bluetooth link on its own (b330) and every
     *  browser's Tablet|PC control shifts — then connect. Early connect attempts may
     *  lose the race with the PC's release; the arbitration fast ticks retry. */
    fun requestTakeover() {
        relay.writePreferred("tablet")
        connectToDefault()
    }

    /** Explicit handoff (user confirmed in the UI): point `preferred` at the PC so
     *  it picks the phone up within seconds, then release our link. */
    fun handoffToOtherHost() {
        relay.writePreferred("pc")
        handoffRelease()
    }

    /** Cleanly release the Bluetooth link so another host can take over. */
    fun handoffRelease() {
        released = true
        executor.execute {
            HostLog.add("[HOST] Handoff release — dropping BT link for another host")
            try { map.registerForNotifications(false) } catch (_: Exception) {}
            map.disconnect()
            hfp.disconnect()
            mns?.stop()
            updateNotification("Disconnected — another device is handling your phone")
        }
    }

    private fun startHistoryLoad() {
        if (!historyLoading.compareAndSet(false, true)) return
        executor.execute {
            try {
                map.fullHistoryLoad(
                    knownHandles = messageStore.knownHandles(),
                    isPaused = { realOpActive || sending.get() },
                    onBatch = { batch ->
                        val added = messageStore.merge(batch)
                        if (added > 0) HostLog.add("[FULLHIST] merged +$added")
                    },
                    isCancelled = { !map.isConnected },
                )
            } finally {
                historyLoading.set(false)
            }
        }
    }

    private fun runPbapImport() {
        val address = defaultDeviceAddress
        if (address.isBlank()) return
        executor.execute {
            try {
                val device = adapter?.getRemoteDevice(address) ?: return@execute
                realOpActive = true
                val result = try { pbap.importAll(device) } finally { realOpActive = false }
                if (result.succeeded) {
                    lastPbapImportAt = System.currentTimeMillis()
                    val calls = callLogStore.merge(result.calls)
                    val contacts = contactStore.merge(result.contacts)
                    HostLog.add("[HOST] PBAP merged +$calls calls, +$contacts contacts")
                } else {
                    HostLog.add("[HOST] PBAP unavailable: ${result.summary}")
                }
            } catch (ex: Exception) {
                HostLog.add("[HOST] PBAP import error: ${ex.message}")
            }
        }
    }

    // ── HFP wiring ────────────────────────────────────────────────────────
    private var lastCallStatus = CallStatus.Idle

    private fun wireHfp() {
        hfp.onStatus = { statusHfp = it; HostLog.add("[HFP] $it") }
        hfp.onCallStateChanged = { call ->
            // Record history when a call transitions to Idle
            if (call.status == CallStatus.Idle && lastCallStatus != CallStatus.Idle) {
                val duration = if (call.startTime > 0 && lastCallStatus == CallStatus.Active)
                    ((System.currentTimeMillis() - call.startTime) / 1000).toInt() else 0
                if (call.number.isNotBlank()) {
                    callLogStore.addLive(call.number, call.direction, call.startTime, duration, defaultDeviceAddress)
                }
            }
            lastCallStatus = call.status
            val who = contactStore.nameFor(call.number)
                ?: ApiJson.formatPhoneDisplay(call.number).ifBlank { "unknown number" }
            updateNotification(
                when (call.status) {
                    CallStatus.IncomingRinging -> "Incoming call from $who"
                    CallStatus.Dialing -> "Calling $who…"
                    CallStatus.Active -> "On a call with $who"
                    else -> if (isFullyConnected()) "Connected to ${defaultDeviceLabel()}"
                            else "Reconnecting to ${defaultDeviceLabel()}…"
                },
            )
        }
    }

    // ── MNS wiring ────────────────────────────────────────────────────────
    private fun wireMns() {
        val a = adapter ?: return
        val server = MnsServer(a)
        server.onNewMessage = { handle, folder ->
            executor.execute {
                try {
                    if (map.isConnected) {
                        val newMsgs = map.performDeltaSync()
                        val added = messageStore.merge(newMsgs)
                        HostLog.add("[MNS→SYNC] $folder $handle → +$added messages")
                    }
                } catch (ex: Exception) {
                    HostLog.add("[MNS→SYNC] failed: ${ex.message}")
                }
            }
        }
        server.onMessageDelivered = { handle -> map.rememberKnownHandle(handle) }
        mns = server
    }

    // ── API routes ────────────────────────────────────────────────────────
    private fun wireApi() {
        api.handler = { req ->
            when {
                // ── Auth (before everything else) ──────────────────────────
                // /health stays open (liveness probe carries no data);
                // /pair exchanges the caller's Firebase ID token for a host
                // token; every other route requires X-Host-Token once an
                // owner account has claimed this host.
                // Only the Windows DeskPhone implements LAN forwarding; answering a
                // forwarded request as ourselves would let this host masquerade as
                // the proxy target in the web app's host probe.
                req.headers.containsKey("x-forward-host") ->
                    LocalApiServer.Response(501, ApiJson.error("this host does not proxy to other hosts"))
                req.path == "/health" ->
                    ok(JSONObject().put("ok", true).put("build", BUILD_STAMP)
                        .put("authRequired", hostAuth.isEnforced()).toString())
                req.method == "POST" && req.path == "/pair" -> {
                    val (status, body) = hostAuth.pair(req.bearerToken ?: req.qs("idToken"))
                    LocalApiServer.Response(status, body)
                }
                hostAuth.isEnforced() && !hostAuth.isValidHostToken(req.hostToken) ->
                    LocalApiServer.Response(401, ApiJson.error(
                        "unauthorized — sign into Shamash with the owner's Google account to pair"))

                else -> routeRequest(req)
            }
        }
    }

    /** The host contract routes, past the auth gate. Shared by the LAN API and the
     *  cloud-relay command drain (RelayClient) so remote commands can never drift
     *  from what the local API does. */
    internal fun routeRequest(req: LocalApiServer.Request): LocalApiServer.Response? {
        val r: LocalApiServer.Response? = when {
                req.path == "" || req.path == "/" || req.path == "/status" ->
                    ok(statusJson())
                req.path == "/log" ->
                    ok(HostLog.tail(req.qsInt("n", 100)).joinToString("\n"))
                req.path == "/messages" -> {
                    val limit = req.qsInt("limit", 1200).coerceIn(50, 5000)
                    val includeAttachmentData = req.qsInt("includeAttachmentData", 0) != 0
                    val arr = JSONArray()
                    messageStore.all()
                        .sortedByDescending { it.timestamp }
                        .take(limit)
                        .forEach { arr.put(ApiJson.message(it, contactStore::nameFor, includeAttachmentData)) }
                    ok(arr.toString())
                }
                req.path == "/calls" -> {
                    val arr = JSONArray()
                    callLogStore.all().take(req.qsInt("limit", 1000).coerceIn(10, 1000))
                        .forEach { arr.put(ApiJson.call(it, contactStore::nameFor)) }
                    ok(arr.toString())
                }
                req.path == "/contacts" -> {
                    val arr = JSONArray()
                    contactStore.all().forEach { arr.put(ApiJson.contact(it)) }
                    ok(arr.toString())
                }
                req.method == "POST" && req.path == "/connect" -> {
                    connectToDefault()
                    ok(ApiJson.result("connect requested"))
                }
                req.method == "POST" && req.path == "/connect-saved-device" -> {
                    val addr = req.qs("addr")
                    if (addr.isBlank()) bad("missing ?addr=ADDRESS")
                    else { connectTo(addr); ok(ApiJson.result("saved device connect requested")) }
                }
                req.method == "POST" && req.path == "/set-default-saved-device" -> {
                    val addr = req.qs("addr")
                    if (addr.isBlank()) bad("missing ?addr=ADDRESS")
                    else { defaultDeviceAddress = addr; ok(ApiJson.result("default saved device updated")) }
                }
                req.method == "POST" && req.path == "/handoff-release" -> {
                    handoffRelease()
                    ok(ApiJson.result("link released for another host"))
                }
                req.method == "POST" && req.path == "/answer" -> {
                    executor.execute { runCatching { hfp.answer() } }
                    ok(ApiJson.result("answering"))
                }
                req.method == "POST" && req.path == "/hangup" -> {
                    executor.execute { runCatching { hfp.hangUp() } }
                    ok(ApiJson.result("hanging up"))
                }
                req.method == "POST" && req.path == "/dial" -> {
                    val n = req.qs("n")
                    if (n.isBlank()) bad("missing ?n=NUMBER")
                    else {
                        executor.execute { runCatching { hfp.dial(n) } }
                        ok(ApiJson.result("dialing $n"))
                    }
                }
                req.method == "POST" && req.path == "/send" -> {
                    val to = req.qs("to")
                    val text = req.qs("body")
                    // Optional client message id from the web composer's echo
                    // bubble — becomes the local echo's id so the state blob
                    // returns it verbatim and the browser reconciles exactly.
                    val cid = req.qs("cid")
                    if (to.isBlank() || text.isBlank()) bad("missing ?to=X&body=Y")
                    else ok(ApiJson.result(if (sendMessageBlocking(to, text, cid.ifBlank { null })) "sent" else "failed"))
                }
                req.method == "POST" && req.path == "/refresh" -> {
                    executor.execute {
                        runCatching {
                            if (map.isConnected) {
                                messageStore.merge(map.performDeltaSync())
                                messageStore.applyReadStates(map.getRecentReadStatesByHandle())
                            }
                        }
                    }
                    ok(ApiJson.result("refresh requested"))
                }
                req.method == "POST" && req.path == "/mark-conversation-read" ->
                    markConversation(req.qs("phone"), read = true)
                req.method == "POST" && req.path == "/mark-conversation-unread" ->
                    markConversation(req.qs("phone"), read = false)
                req.method == "POST" && req.path == "/toggle-message-pin" -> {
                    val id = req.qs("id")
                    if (id.isBlank()) bad("missing ?id=ID")
                    else { messageStore.togglePin(id); ok(ApiJson.result("message pin toggled")) }
                }
                req.method == "POST" && req.path == "/delete-message" -> {
                    val id = req.qs("id")
                    if (id.isBlank()) bad("missing ?id=ID")
                    else {
                        val removed = messageStore.remove(id)
                        if (removed != null && removed.handle.isNotBlank() && map.isConnected) {
                            executor.execute {
                                runCatching { map.setMessageDeletedStatus(removed.handle, true) }
                            }
                        }
                        ok(ApiJson.result("message deleted"))
                    }
                }
                req.method == "POST" && req.path == "/save-contact" -> {
                    val name = req.qs("name")
                    val phone = req.qs("phone")
                    if (name.isBlank() || phone.isBlank()) bad("missing ?name=X&phone=Y")
                    else { contactStore.save(name, phone, defaultDeviceAddress); ok(ApiJson.result("contact saved")) }
                }
                req.method == "POST" && req.path == "/delete-contact" -> {
                    contactStore.delete(req.qs("id"), req.qs("phone"))
                    ok(ApiJson.result("contact deleted"))
                }
                req.method == "POST" && req.path == "/scan-devices" ->
                    ok(ApiJson.result("device scan complete")) // paired list is always live in /status
                req.path == "/lan-url" ->
                    ok(JSONObject().put("lanUrl", lanUrl() ?: JSONObject.NULL).toString())
                else -> null
        }
        return r
    }

    private fun ok(body: String) = LocalApiServer.Response(200, body)
    private fun bad(message: String) = LocalApiServer.Response(400, ApiJson.error(message))

    private fun markConversation(phone: String, read: Boolean): LocalApiServer.Response {
        if (phone.isBlank()) return bad("missing ?phone=NUMBER")
        val touched = messageStore.markConversationRead(phone, read)
        if (map.isConnected && touched.isNotEmpty()) {
            executor.execute {
                for (handle in touched) runCatching { map.setMessageReadStatus(handle, read) }
            }
        }
        return ok(ApiJson.result("conversation marked ${if (read) "read" else "unread"}"))
    }

    private fun sendMessageBlocking(to: String, text: String, clientMessageId: String? = null): Boolean {
        if (!map.isConnected) { HostLog.add("[SEND] rejected — MAP not connected"); return false }
        sending.set(true)
        realOpActive = true
        val local = messageStore.addLocalSent(to, text, "sending", clientMessageId)
        return try {
            val sent = map.sendMessage(to, text)
            if (sent) {
                val handle = runCatching { map.getNewestSentHandle() }.getOrNull()
                map.rememberKnownHandle(handle)
                messageStore.updateSendStatus(local.localId!!, "sent", handle)
            } else {
                messageStore.updateSendStatus(local.localId!!, "failed")
            }
            sent
        } catch (ex: Exception) {
            HostLog.add("[SEND] error: ${ex.message}")
            messageStore.updateSendStatus(local.localId!!, "failed")
            false
        } finally {
            sending.set(false)
            realOpActive = false
        }
    }

    // ── /status JSON (Windows-contract superset the web surfaces read) ────
    private fun statusJson(): String {
        val o = JSONObject()
        o.put("hostConnector", "Shamash Android Host")
        o.put("hostPlatform", "android")
        o.put("hostControlContract", "deskphone-host-control/v1")
        o.put("hostScope", "lan")
        o.put(
            "phoneTransport",
            JSONObject().put("calls", "HFP").put("messages", "MAP").put("contacts", "PBAP"),
        )
        o.put("connected", isFullyConnected())
        o.put("hfp", statusHfp)
        o.put("map", statusMap)
        val call = hfp.currentCall
        o.put("callState", call.status.name)
        o.put("callNumber", call.number)
        o.put("isRinging", call.status == CallStatus.IncomingRinging)
        o.put("isCallActive", call.status == CallStatus.Active || call.status == CallStatus.Dialing)
        o.put("isMuted", false)
        o.put("conversationCount", messageStore.conversationCount())
        o.put("messageCount", messageStore.count())
        val last = messageStore.all().maxByOrNull { it.timestamp }
        o.put(
            "lastMessage",
            if (last == null) JSONObject.NULL
            else JSONObject().put("from", if (last.isSent) "Me" else last.from).put("preview", last.previewBody),
        )
        val recent = JSONArray()
        callLogStore.all().take(8).forEach { recent.put(ApiJson.call(it, contactStore::nameFor)) }
        o.put("recentCalls", recent)
        o.put("isSendingMessage", sending.get())
        o.put("showReconnectPrompt", !isFullyConnected() && defaultDeviceAddress.isNotBlank())
        o.put("bluetoothStatus", if (adapter?.isEnabled == true) "Bluetooth on" else "Bluetooth off")
        o.put("isScanning", false)
        o.put("isConnecting", connecting.get())
        o.put("selectedDeviceAddress", defaultDeviceAddress)
        val known = JSONArray()
        val scanned = JSONArray()
        try {
            for (d in adapter?.bondedDevices ?: emptySet<BluetoothDevice>()) {
                scanned.put(
                    JSONObject()
                        .put("address", d.address)
                        .put("name", d.name ?: d.address)
                        .put("isPaired", true),
                )
                known.put(
                    JSONObject()
                        .put("address", d.address)
                        .put("name", d.name ?: d.address)
                        .put("isDefault", d.address == defaultDeviceAddress)
                        .put("lastSeen", ""),
                )
            }
        } catch (_: Exception) {}
        o.put("knownDevices", known)
        o.put("scannedDevices", scanned)
        o.put("hostReleased", released)
        o.put("appVisible", true)
        o.put("build", BUILD_STAMP)
        return o.toString()
    }

    // ── NSD (mDNS) advertising for LAN discovery ──────────────────────────
    private fun registerNsd() {
        try {
            val info = NsdServiceInfo().apply {
                serviceName = "Shamash Phone Host"
                serviceType = "_shamash-phonehost._tcp."
                port = 8765
            }
            val listener = object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(i: NsdServiceInfo) { HostLog.add("[NSD] Advertised ${i.serviceName}") }
                override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) { HostLog.add("[NSD] Registration failed: $code") }
                override fun onServiceUnregistered(i: NsdServiceInfo) {}
                override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
            }
            nsdManager = getSystemService(Context.NSD_SERVICE) as NsdManager
            nsdManager?.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
            nsdListener = listener
        } catch (ex: Exception) {
            HostLog.add("[NSD] unavailable: ${ex.message}")
        }
    }

    private fun unregisterNsd() {
        try { nsdListener?.let { nsdManager?.unregisterService(it) } } catch (_: Exception) {}
    }

    fun lanUrl(): String? = try {
        java.net.NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { !it.isLoopbackAddress && it is java.net.Inet4Address }
            ?.let { "http://${it.hostAddress}:8765" }
    } catch (_: Exception) { null }

    // ── Notification ──────────────────────────────────────────────────────
    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Phone Host", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID)
                      else @Suppress("DEPRECATION") Notification.Builder(this)
        return builder
            .setContentTitle("Shamash Phone Host")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }
}
