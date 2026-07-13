package com.shamash.phonehost.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import com.shamash.phonehost.HostLog
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/**
 * MAP Message Notification Service (MNS) server — UUID 0x1133.
 * After we register for notifications on the phone's MAS, the phone connects
 * back to this RFCOMM listener and delivers OBEX PUTs containing MAP event
 * report XML (NewMessage / DeliverySuccess / MessageRead / …).
 *
 * listenUsingRfcommWithServiceRecord registers the SDP record automatically,
 * which is all the phone's MNS client needs to find us.
 */
@SuppressLint("MissingPermission")
class MnsServer(
    private val adapter: BluetoothAdapter,
    private val log: (String) -> Unit = { HostLog.add(it) },
) {
    companion object {
        val MNS_UUID: UUID = UUID.fromString("00001133-0000-1000-8000-00805F9B34FB")
        private const val HDR_BODY = 0x48
        private const val HDR_END_BODY = 0x49
        private const val HDR_CONN_ID = 0xCB
    }

    var onNewMessage: ((handle: String, folder: String) -> Unit)? = null
    var onMessageDelivered: ((handle: String) -> Unit)? = null
    var onMessageRead: ((handle: String) -> Unit)? = null

    /**
     * Fired on EVERY event PUT, even a zero-byte one, before XML parsing.
     * The owner's handset (kosher MediaTek firmware) always sends empty MAP
     * event reports — no type, no handle — so this generic "something changed
     * on the phone" signal is the only push trigger that actually fires there.
     */
    var onEventReceived: (() -> Unit)? = null

    @Volatile
    var isRunning = false
        private set

    private var serverSocket: BluetoothServerSocket? = null
    private var acceptThread: Thread? = null

    fun start() {
        if (isRunning) return
        try {
            serverSocket = adapter.listenUsingRfcommWithServiceRecord(
                "MAP Message Notification Service", MNS_UUID,
            )
            isRunning = true
            acceptThread = Thread({ acceptLoop() }, "mns-accept").apply {
                isDaemon = true
                start()
            }
            log("[MNS] RFCOMM server started")
        } catch (ex: Exception) {
            log("[MNS] Failed to start: ${ex.message}")
        }
    }

    fun stop() {
        isRunning = false
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
    }

    private fun acceptLoop() {
        while (isRunning) {
            try {
                val client = serverSocket?.accept() ?: break
                log("[MNS] Phone connected — serving OBEX")
                Thread({ serveClient(client) }, "mns-client").apply {
                    isDaemon = true
                    start()
                }
            } catch (ex: Exception) {
                if (isRunning) log("[MNS] Accept error: ${ex.message}")
                if (!isRunning) break
                Thread.sleep(2000)
            }
        }
    }

    // Phone acts as the OBEX client: CONNECT → PUT (event) × N → DISCONNECT
    private fun serveClient(client: BluetoothSocket) {
        client.use { sock ->
            val input = sock.inputStream
            val output = sock.outputStream
            val connId = 1L
            try {
                while (isRunning) {
                    val pkt = readPacket(input)
                    if (pkt.isEmpty()) break
                    when (val opcode = pkt[0].toInt() and 0xFF) {
                        0x80 -> { // CONNECT
                            val connIdHeader = byteArrayOf(
                                HDR_CONN_ID.toByte(),
                                (connId shr 24).toByte(), (connId shr 16).toByte(),
                                (connId shr 8).toByte(), (connId and 0xFF).toByte(),
                            )
                            val total = 7 + connIdHeader.size
                            val resp = ByteArray(total)
                            resp[0] = 0xA0.toByte() // OK
                            resp[1] = (total shr 8).toByte()
                            resp[2] = (total and 0xFF).toByte()
                            resp[3] = 0x10 // OBEX 1.0
                            resp[4] = 0x00
                            resp[5] = 0xFF.toByte()
                            resp[6] = 0xFF.toByte()
                            connIdHeader.copyInto(resp, 7)
                            output.write(resp); output.flush()
                            log("[MNS] OBEX CONNECT accepted")
                        }
                        0x82, 0x02 -> { // PUT (final / non-final)
                            val body = ByteArrayOutputStream()
                            var finalPkt = (opcode and 0x80) != 0
                            extractBody(pkt, body)
                            var more = pkt
                            while (!finalPkt) {
                                output.write(byteArrayOf(0x90.toByte(), 0x00, 0x03)) // Continue
                                output.flush()
                                more = readPacket(input)
                                if (more.isEmpty()) return
                                finalPkt = (more[0].toInt() and 0x80) != 0
                                extractBody(more, body)
                            }
                            output.write(byteArrayOf(0xA0.toByte(), 0x00, 0x03)) // OK
                            output.flush()
                            parseEventReport(String(body.toByteArray(), Charsets.UTF_8))
                        }
                        0x81 -> { // DISCONNECT
                            output.write(byteArrayOf(0xA0.toByte(), 0x00, 0x03))
                            output.flush()
                            log("[MNS] Phone disconnected gracefully")
                            return
                        }
                        else -> {
                            log("[MNS] Unknown opcode 0x%02X".format(opcode))
                            output.write(byteArrayOf(0xD3.toByte(), 0x00, 0x03))
                            output.flush()
                        }
                    }
                }
            } catch (ex: Exception) {
                log("[MNS] Client error: ${ex.message}")
            }
        }
    }

    private fun parseEventReport(xml: String) {
        // Generic signal first: even a bodyless PUT proves the phone pushed an event.
        onEventReceived?.invoke()

        // Some Android firmware sends empty MAP event notifications (this handset
        // ALWAYS does) — onEventReceived above already turned it into a sync trigger.
        if (xml.isBlank()) {
            log("[MNS] Event body empty — treating as generic change signal")
            return
        }
        log("[MNS] Event: ${xml.replace("\n", "↵").replace("\r", "")}")
        val event = Regex("<event\\s+([^>]*)/?>", RegexOption.IGNORE_CASE).find(xml) ?: run {
            log("[MNS] No <event> node found in report")
            return
        }
        val attrs = HashMap<String, String>()
        for (a in Regex("([a-zA-Z_]+)\\s*=\\s*\"([^\"]*)\"").findAll(event.groupValues[1])) {
            attrs[a.groupValues[1].lowercase()] = a.groupValues[2]
        }
        val type = attrs["type"] ?: ""
        val handle = attrs["handle"] ?: ""
        val folder = attrs["folder"] ?: ""
        log("[MNS] type=$type handle=$handle folder=$folder")
        when (type.lowercase()) {
            "newmessage" -> onNewMessage?.invoke(handle, folder)
            "deliverycomplete", "deliverysuccess" -> onMessageDelivered?.invoke(handle)
            "messageread" -> onMessageRead?.invoke(handle)
            else -> log("[MNS] Event type '$type' not handled")
        }
    }

    private fun readPacket(input: InputStream): ByteArray {
        val hdr = ByteArray(3)
        if (readExact(input, hdr, 0, 3) < 3) return ByteArray(0)
        val total = ((hdr[1].toInt() and 0xFF) shl 8) or (hdr[2].toInt() and 0xFF)
        if (total < 3) return ByteArray(0)
        val pkt = ByteArray(total)
        hdr.copyInto(pkt, 0)
        if (total > 3) readExact(input, pkt, 3, total - 3)
        return pkt
    }

    private fun readExact(input: InputStream, buf: ByteArray, offset: Int, count: Int): Int {
        var total = 0
        while (total < count) {
            val n = input.read(buf, offset + total, count - total)
            if (n <= 0) break
            total += n
        }
        return total
    }

    private fun extractBody(pkt: ByteArray, dest: ByteArrayOutputStream) {
        var i = 3
        while (i + 2 < pkt.size) {
            val hdrId = pkt[i].toInt() and 0xFF
            // 4-byte fixed headers (0xC0-0xFF) have no length field
            if (hdrId shr 6 == 0b11) { i += 5; continue }
            if (hdrId shr 6 == 0b10) { i += 2; continue }
            val hdrLen = ((pkt[i + 1].toInt() and 0xFF) shl 8) or (pkt[i + 2].toInt() and 0xFF)
            if (hdrLen < 3 || i + hdrLen > pkt.size) break
            if (hdrId == HDR_BODY || hdrId == HDR_END_BODY) dest.write(pkt, i + 3, hdrLen - 3)
            i += hdrLen
        }
    }
}
