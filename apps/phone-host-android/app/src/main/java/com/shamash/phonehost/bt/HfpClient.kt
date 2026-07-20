package com.shamash.phonehost.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import com.shamash.phonehost.CallDirection
import com.shamash.phonehost.CallInfo
import com.shamash.phonehost.CallStatus
import com.shamash.phonehost.HostLog
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * HFP (Hands-Free Profile) client — port of the Windows HfpService.
 * Opens RFCOMM to the phone's HFP Audio Gateway (UUID 0x111F), runs the AT
 * handshake, then listens for call events (RING/+CLIP/+CIEV).
 *
 * Same deliberate choice as Windows: we do NOT advertise codec negotiation
 * in BRSF (features = 0x04, CLI only), so the phone never routes SCO audio at
 * this channel. On Android there is no equivalent of Windows' BthHFEnum HF
 * audio driver for an app-level host, so v1 is call CONTROL only — answer /
 * hang up / dial from any surface; the voice path stays on the phone (or a
 * headset paired to the phone).
 */
@SuppressLint("MissingPermission")
class HfpClient(private val log: (String) -> Unit = { HostLog.add(it) }) {

    companion object {
        val HFP_AG_UUID: UUID = UUID.fromString("0000111F-0000-1000-8000-00805F9B34FB")
        private const val OUR_FEATURES = 0x04 // CLI only — stay out of the audio path
    }

    var isConnected = false
        private set
    var currentCall = CallInfo()
        private set

    var onCallStateChanged: ((CallInfo) -> Unit)? = null
    var onStatus: ((String) -> Unit)? = null

    private var socket: BluetoothSocket? = null
    private var reader: BufferedReader? = null
    private var writer: OutputStreamWriter? = null
    private var readThread: Thread? = null
    @Volatile private var stopping = false
    private val writeLock = ReentrantLock()
    @Volatile private var lastTrafficAt = 0L
    @Volatile private var clccSawCall = false // set when a +CLCC row arrives (active-call check)

    // CIND indicator index → name, populated during handshake
    private val indicators = HashMap<Int, String>()

    // ── Connect ───────────────────────────────────────────────────────────
    fun connect(device: BluetoothDevice) {
        onStatus?.invoke("Connecting HFP…")
        stopping = false
        val s = device.createRfcommSocketToServiceRecord(HFP_AG_UUID)
        try {
            s.connect()
            socket = s
            reader = BufferedReader(InputStreamReader(s.inputStream, Charsets.US_ASCII))
            writer = OutputStreamWriter(s.outputStream, Charsets.US_ASCII)
            runHandshake()
        } catch (ex: Exception) {
            // Failed mid-connect/handshake: close the socket or it leaks and can
            // hold the RFCOMM channel hostage against the next attempt.
            try { s.close() } catch (_: Exception) {}
            socket = null
            throw ex
        }

        isConnected = true
        lastTrafficAt = System.currentTimeMillis()
        onStatus?.invoke("HFP connected")
        readThread = Thread({ readLoop() }, "hfp-read").apply { isDaemon = true; start() }
    }

    fun disconnect() {
        stopping = true
        try { socket?.close() } catch (_: Exception) {}
        socket = null
        isConnected = false
    }

    private fun runHandshake() {
        send("AT+BRSF=$OUR_FEATURES")
        expectOk("+BRSF")
        send("AT+CIND=?")
        parseCindDefinition(expectOk("+CIND:"))
        send("AT+CIND?")
        parseCindValues(expectOk("+CIND:"))
        send("AT+CMER=3,0,0,1")
        expectOk("OK")
        send("AT+CLIP=1")
        expectOk("OK")
        send("AT+CCWA=1")
        expectOk("OK", acceptError = true)
        // Codec negotiation (+BCS) arrives later as a URC; we ignore it (no audio path).
    }

    // ── Read loop with keepalive ──────────────────────────────────────────
    private fun readLoop() {
        try {
            val r = reader ?: return
            // Reads block; a keepalive thread probes the link during long idles.
            val keepalive = Thread({ keepaliveLoop() }, "hfp-keepalive").apply {
                isDaemon = true
                start()
            }
            while (!stopping) {
                val raw = r.readLine() ?: break // stream closed
                lastTrafficAt = System.currentTimeMillis()
                val line = raw.trim()
                if (line.isEmpty()) continue
                log("← $line")
                handleUrcLine(line)
            }
        } catch (ex: Exception) {
            if (!stopping) log("[HFP read error] ${ex.message}")
        } finally {
            isConnected = false
            onStatus?.invoke("HFP disconnected")
            // If the phone dropped mid-call without a clean call=0, clear the UI.
            if (currentCall.status != CallStatus.Idle) forceIdle()
        }
    }

    private fun keepaliveLoop() {
        while (!stopping && isConnected) {
            Thread.sleep(5000)
            val idleMs = System.currentTimeMillis() - lastTrafficAt
            if (idleMs < 30_000) continue
            // During a call the generic probe stays off (AT+NREC during audio
            // confuses some firmware) — but a lost +CIEV call=0 used to leave a
            // phantom "active call" on screen forever. After 30 s of URC silence
            // ask the phone for its real call list instead: AT+CLCC is the
            // standard carkit in-call status poll. A reply with no +CLCC rows
            // means the call already ended — clear it. (Was 60 s; owner ticket
            // 7/17: a call that ended on the handset lingered as live far too
            // long — every CLCC reply resets lastTrafficAt, so this is in
            // effect a ~30 s poll for the whole phantom window.)
            if (currentCall.status != CallStatus.Idle) {
                try {
                    clccSawCall = false
                    log("[keepalive] active-call check — AT+CLCC")
                    send("AT+CLCC")
                    Thread.sleep(3000)
                    val answered = System.currentTimeMillis() - lastTrafficAt < 3_000
                    if (answered && !clccSawCall && currentCall.status != CallStatus.Idle) {
                        log("[keepalive] phone reports no calls — clearing phantom active call")
                        forceIdle()
                    }
                } catch (ex: Exception) {
                    if (!stopping) {
                        log("[keepalive] ${ex.message}")
                        try { socket?.close() } catch (_: Exception) {}
                    }
                    return
                }
                continue
            }
            try {
                log("[keepalive] 30 s idle — probing HFP link with AT+NREC=0")
                send("AT+NREC=0")
                // The phone answers every AT command (OK or ERROR). If nothing
                // arrives in 10 s, the link is dead — close to trigger reconnect.
                val probeStart = System.currentTimeMillis()
                while (System.currentTimeMillis() - probeStart < 10_000) {
                    if (System.currentTimeMillis() - lastTrafficAt < 2_000) break
                    Thread.sleep(500)
                }
                if (System.currentTimeMillis() - lastTrafficAt >= 10_000) {
                    throw IOException("keepalive probe got no reply — link presumed dead")
                }
            } catch (ex: Exception) {
                if (!stopping) {
                    log("[keepalive] ${ex.message}")
                    try { socket?.close() } catch (_: Exception) {}
                }
                return
            }
        }
    }

    // ── URC handling ──────────────────────────────────────────────────────
    private fun handleUrcLine(line: String) {
        if (line.startsWith("+BCS:")) {
            // We don't advertise codec negotiation; never answer AT+BCS= here
            // or the phone would route SCO audio to this app-level channel.
            log("[codec negotiation: ignoring $line (no audio path on app host)]")
            return
        }

        if (line == "RING") {
            if (currentCall.status != CallStatus.IncomingRinging) {
                replaceCallState(CallInfo(CallStatus.IncomingRinging, CallDirection.Incoming))
            }
            return
        }

        if (line.startsWith("+CLIP:")) {
            // +CLIP: "+15551234567",145,,,,0
            val number = line.substring(6).split(',').firstOrNull()?.trim()?.trim('"') ?: ""
            if (number.isNotBlank()) {
                currentCall.number = number
                currentCall.displayName = null
                publishCallState()
            }
            return
        }

        if (line.startsWith("+CIEV:")) {
            val parts = line.substring(6).trim().split(',')
            if (parts.size < 2) return
            val idx = parts[0].trim().toIntOrNull() ?: return
            val value = parts[1].trim().toIntOrNull() ?: return
            indicators[idx]?.let { handleIndicator(it, value) }
            return
        }

        if (line.startsWith("+CLCC:")) {
            clccSawCall = true
            return
        }

        if (line.startsWith("+CCWA:")) log("[call waiting] $line")
    }

    private fun handleIndicator(name: String, value: Int) {
        when (name.lowercase()) {
            "call" -> {
                if (value == 0 && currentCall.status != CallStatus.Idle) {
                    // Call ended. Direction is preserved for history recording.
                    forceIdle()
                } else if (value == 1 && currentCall.status != CallStatus.Active) {
                    // A connected call is by definition not missed — if a reordered
                    // callsetup=0 already misfiled the direction, correct it here.
                    if (currentCall.direction == CallDirection.Missed) {
                        currentCall.direction = CallDirection.Incoming
                    }
                    currentCall.status = CallStatus.Active
                    currentCall.startTime = System.currentTimeMillis()
                    publishCallState()
                }
            }
            "callsetup" -> when (value) {
                0 -> {
                    // Setup over. If still ringing/dialing this LOOKS like a hang-up /
                    // missed call — but several AGs send callsetup=0 BEFORE call=1 when
                    // the call is answered on the handset. Deciding "missed" right here
                    // misfiled real conversations as missed calls, so give the call
                    // indicator a moment to land before classifying.
                    if (currentCall.status == CallStatus.IncomingRinging ||
                        currentCall.status == CallStatus.Dialing
                    ) {
                        val candidateStatus = currentCall.status
                        val candidateNumber = currentCall.number
                        Thread {
                            Thread.sleep(800)
                            if (currentCall.status == candidateStatus && currentCall.number == candidateNumber) {
                                val direction = if (currentCall.direction == CallDirection.Outgoing)
                                    CallDirection.Outgoing else CallDirection.Missed
                                replaceCallState(CallInfo(CallStatus.Idle, direction, candidateNumber))
                            }
                        }.apply { isDaemon = true }.start()
                    }
                }
                1 -> if (currentCall.status != CallStatus.IncomingRinging) {
                    replaceCallState(CallInfo(CallStatus.IncomingRinging, CallDirection.Incoming))
                }
                2, 3 -> if (currentCall.status != CallStatus.Dialing) {
                    replaceCallState(CallInfo(CallStatus.Dialing, CallDirection.Outgoing, currentCall.number))
                }
            }
        }
    }

    // ── Call control ──────────────────────────────────────────────────────
    fun answer() {
        send("ATA")
    }

    fun hangUp() {
        val hadCall = currentCall.status != CallStatus.Idle
        if (hadCall && currentCall.status != CallStatus.Ending) {
            currentCall.status = CallStatus.Ending
            publishCallState()
        }
        try {
            send("AT+CHUP")
        } catch (ex: Exception) {
            if (!hadCall) throw ex
            // AG link already bad — still honor the local hang-up so the UI clears.
        }
        if (!hadCall) return
        Thread {
            Thread.sleep(1200)
            if (currentCall.status != CallStatus.Idle) forceIdle()
        }.apply { isDaemon = true }.start()
    }

    fun dial(number: String) {
        val clean = number.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        replaceCallState(CallInfo(CallStatus.Dialing, CallDirection.Outgoing, clean))
        send("ATD$clean;")
    }

    // ── CIND parsing ──────────────────────────────────────────────────────
    private fun parseCindDefinition(line: String) {
        val payload = if (line.startsWith("+CIND:")) line.substring(6) else line
        var idx = 1
        for (chunk in payload.split('(')) {
            val nameEnd = chunk.indexOf('"', 1)
            if (nameEnd < 2) continue
            indicators[idx++] = chunk.substring(1, nameEnd)
        }
    }

    private fun parseCindValues(line: String) {
        val payload = if (line.startsWith("+CIND:")) line.substring(6) else line
        val parts = payload.trim().split(',')
        for (i in parts.indices) {
            parts[i].trim().toIntOrNull()?.let { value ->
                indicators[i + 1]?.let { handleIndicator(it, value) }
            }
        }
    }

    // ── Low-level send / expect ───────────────────────────────────────────
    private fun send(cmd: String) {
        log("→ $cmd")
        writeLock.withLock {
            val w = writer ?: throw IOException("HFP writer closed")
            w.write(cmd + "\r")
            w.flush()
        }
    }

    private fun expectOk(prefix: String, acceptError: Boolean = false, timeoutMs: Long = 8000): String {
        val r = reader ?: throw IOException("HFP reader closed")
        var matched = ""
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val raw = r.readLine() ?: throw IOException("HFP stream closed during handshake")
            val line = raw.trim()
            if (line.isEmpty()) continue
            log("← $line")
            if (line.startsWith(prefix, ignoreCase = true)) {
                matched = line
                if (prefix == "OK") break
                continue
            }
            if (line == "OK") break
            if (line == "ERROR" || line.startsWith("+CME ERROR")) {
                if (acceptError) break
                log("[ERROR for $prefix — continuing anyway]")
                break
            }
        }
        return matched
    }

    // ── State helpers ─────────────────────────────────────────────────────
    private fun replaceCallState(call: CallInfo) {
        currentCall = call
        publishCallState()
    }

    private fun forceIdle() {
        replaceCallState(
            CallInfo(
                CallStatus.Idle, currentCall.direction, currentCall.number,
                currentCall.displayName, currentCall.startTime,
            ),
        )
    }

    private fun publishCallState() {
        onCallStateChanged?.invoke(currentCall.copy())
    }
}
