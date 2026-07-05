package com.shamash.phonehost.bt

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Minimal OBEX client — just enough for MAP/PBAP over an RFCOMM stream.
 * Direct port of the Windows host's ObexClient.cs, including the handset
 * quirks that implementation encodes:
 *  - OBEX version byte 0x10 (1.0) for maximum handset compatibility.
 *  - Fig 52 / MediaTek Lite CONNECT responses may omit the 4 version/flags/
 *    maxPacket bytes; header parsing starts at offset 3 in that case.
 *  - PUT with no body must NOT carry an empty EndBody header (MediaTek
 *    rejects with 0xC0).
 *
 * OBEX is strict request/response — callers must serialize operations.
 */
class ObexResult(val responseCode: Int, val body: ByteArray)

class ObexClient(
    private val input: InputStream,
    private val output: OutputStream,
    private val targetUuid: ByteArray? = MAP_TARGET_UUID,
) {
    var connectionId: Long = 0L
        private set

    companion object {
        // OBEX header IDs
        private const val HDR_NAME = 0x01
        private const val HDR_TYPE = 0x42
        private const val HDR_APP_PARAMS = 0x4C
        private const val HDR_TARGET = 0x46
        private const val HDR_CONN_ID = 0xCB
        private const val HDR_BODY = 0x48
        private const val HDR_END_BODY = 0x49

        // Opcodes
        private const val OP_CONNECT = 0x80
        private const val OP_DISCONNECT = 0x81
        private const val OP_PUT_FINAL = 0x82
        private const val OP_GET_FINAL = 0x83
        private const val OP_SETPATH = 0x85

        // Response codes
        const val RES_OK = 0xA0
        const val RES_CONTINUE = 0x90

        // MAP MAS OBEX target UUID: BB582B40-420C-11DB-B0DE-0800200C9A66
        val MAP_TARGET_UUID = byteArrayOf(
            0xBB.toByte(), 0x58, 0x2B, 0x40, 0x42, 0x0C, 0x11, 0xDB.toByte(),
            0xB0.toByte(), 0xDE.toByte(), 0x08, 0x00, 0x20, 0x0C, 0x9A.toByte(), 0x66,
        )

        // PBAP PSE OBEX target UUID (same bytes the Windows host sends)
        val PBAP_TARGET_UUID = byteArrayOf(
            0x79, 0x61, 0x35, 0xF0.toByte(), 0xF0.toByte(), 0xC5.toByte(), 0x11, 0xD8.toByte(),
            0x09, 0x66, 0x08, 0x00, 0x20, 0x0C, 0x9A.toByte(), 0x66,
        )
    }

    // ── CONNECT ───────────────────────────────────────────────────────────
    fun connect(appParams: ByteArray? = null): Boolean {
        val headers = mutableListOf<ByteArray>()
        targetUuid?.takeIf { it.isNotEmpty() }?.let { headers.add(byteSeqHeader(HDR_TARGET, it)) }
        appParams?.let { headers.add(byteSeqHeader(HDR_APP_PARAMS, it)) }

        val headersLen = headers.sumOf { it.size }
        val total = 7 + headersLen
        val pkt = ByteArray(total)
        pkt[0] = OP_CONNECT.toByte()
        pkt[1] = (total shr 8).toByte()
        pkt[2] = (total and 0xFF).toByte()
        pkt[3] = 0x10 // OBEX 1.0 for maximum handset compatibility
        pkt[4] = 0x00 // flags
        pkt[5] = 0xFF.toByte() // max packet size hi
        pkt[6] = 0xFF.toByte() // max packet size lo
        var offset = 7
        for (h in headers) { h.copyInto(pkt, offset); offset += h.size }

        output.write(pkt)
        output.flush()

        val resp = readPacket()
        if (resp.size < 3 || (resp[0].toInt() and 0xFF) != RES_OK) return false

        // Fig 52 / MediaTek Lite: phone may skip the 4 bytes (Ver/Flags/MaxPkt).
        val headerOffset = if (resp.size >= 7 && (resp[3].toInt() and 0xFF) >= 0x10) 7 else 3
        parseResponseHeaders(resp, headerOffset).first?.let { connectionId = it }
        return true
    }

    // ── SETPATH ───────────────────────────────────────────────────────────
    fun setPath(folderName: String, backup: Boolean = false): Boolean {
        val headers = mutableListOf<ByteArray>()
        if (connectionId != 0L) headers.add(connIdHeader(connectionId))
        // Always include Name header — empty string navigates to root on most servers
        headers.add(unicodeHeader(HDR_NAME, folderName))

        val headersLen = headers.sumOf { it.size }
        val total = 5 + headersLen
        val pkt = ByteArray(total)
        pkt[0] = OP_SETPATH.toByte()
        pkt[1] = (total shr 8).toByte()
        pkt[2] = (total and 0xFF).toByte()
        pkt[3] = if (backup) 0x01 else 0x00
        pkt[4] = 0x00 // constants
        var offset = 5
        for (h in headers) { h.copyInto(pkt, offset); offset += h.size }

        output.write(pkt)
        output.flush()

        val resp = readPacket()
        return resp.isNotEmpty() && (resp[0].toInt() and 0xFF) == RES_OK
    }

    // ── GET (reassembles chunked responses) ───────────────────────────────
    fun get(mimeType: String, name: String? = null, appParams: ByteArray? = null): ByteArray =
        getResult(mimeType, name, appParams).body

    fun getResult(mimeType: String, name: String? = null, appParams: ByteArray? = null): ObexResult {
        val headers = mutableListOf<ByteArray>()
        if (connectionId != 0L) headers.add(connIdHeader(connectionId))
        headers.add(byteSeqHeader(HDR_TYPE, nullTerminatedAscii(mimeType)))
        name?.let { headers.add(unicodeHeader(HDR_NAME, it)) }
        appParams?.let { headers.add(byteSeqHeader(HDR_APP_PARAMS, it)) }

        val headersLen = headers.sumOf { it.size }
        val total = 3 + headersLen
        val pkt = ByteArray(total)
        pkt[0] = OP_GET_FINAL.toByte()
        pkt[1] = (total shr 8).toByte()
        pkt[2] = (total and 0xFF).toByte()
        var offset = 3
        for (h in headers) { h.copyInto(pkt, offset); offset += h.size }

        output.write(pkt)
        output.flush()

        val body = ByteArrayOutputStream()
        var responseCode = 0x00
        while (true) {
            val resp = readPacket()
            if (resp.isEmpty()) break

            responseCode = resp[0].toInt() and 0xFF
            parseResponseHeaders(resp, 3).second?.let { if (it.isNotEmpty()) body.write(it) }

            if (responseCode == RES_OK) break // final packet
            if (responseCode != RES_CONTINUE) break // unexpected — stop

            // Empty GET to continue
            output.write(byteArrayOf(OP_GET_FINAL.toByte(), 0x00, 0x03))
            output.flush()
        }
        return ObexResult(responseCode, body.toByteArray())
    }

    // ── PUT (MAP send / status updates) ───────────────────────────────────
    // Returns the raw OBEX response code (0xA0 OK; Continue handled internally).
    fun put(
        mimeType: String,
        name: String? = null,
        body: ByteArray? = null,
        appParams: ByteArray? = null,
    ): Int {
        val headers = mutableListOf<ByteArray>()
        if (connectionId != 0L) headers.add(connIdHeader(connectionId))
        name?.let { headers.add(unicodeHeader(HDR_NAME, it)) }
        headers.add(byteSeqHeader(HDR_TYPE, nullTerminatedAscii(mimeType)))
        appParams?.let { headers.add(byteSeqHeader(HDR_APP_PARAMS, it)) }
        // No-body PUTs must not carry an empty EndBody header (MediaTek → 0xC0)
        if (body != null && body.isNotEmpty()) headers.add(byteSeqHeader(HDR_END_BODY, body))

        val headersLen = headers.sumOf { it.size }
        val total = 3 + headersLen
        val pkt = ByteArray(total)
        pkt[0] = OP_PUT_FINAL.toByte()
        pkt[1] = (total shr 8).toByte()
        pkt[2] = (total and 0xFF).toByte()
        var offset = 3
        for (h in headers) { h.copyInto(pkt, offset); offset += h.size }

        output.write(pkt)
        output.flush()

        while (true) {
            val resp = readPacket()
            if (resp.isEmpty()) return 0x00
            val code = resp[0].toInt() and 0xFF
            if (code == RES_OK) return RES_OK
            if (code == RES_CONTINUE) {
                output.write(byteArrayOf(OP_PUT_FINAL.toByte(), 0x00, 0x03))
                output.flush()
                continue
            }
            return code
        }
    }

    // ── DISCONNECT ────────────────────────────────────────────────────────
    fun disconnect() {
        val header = if (connectionId != 0L) connIdHeader(connectionId) else ByteArray(0)
        val total = 3 + header.size
        val pkt = ByteArray(total)
        pkt[0] = OP_DISCONNECT.toByte()
        pkt[1] = (total shr 8).toByte()
        pkt[2] = (total and 0xFF).toByte()
        header.copyInto(pkt, 3)
        output.write(pkt)
        output.flush()
        readPacket() // read and discard OK
    }

    // ── Packet reader (length-prefixed) ───────────────────────────────────
    private fun readPacket(): ByteArray {
        val hdr = ByteArray(3)
        if (readExact(hdr, 0, 3) < 3) return ByteArray(0)
        val total = ((hdr[1].toInt() and 0xFF) shl 8) or (hdr[2].toInt() and 0xFF)
        if (total < 3) return ByteArray(0)
        val pkt = ByteArray(total)
        hdr.copyInto(pkt, 0)
        if (total > 3) readExact(pkt, 3, total - 3)
        return pkt
    }

    private fun readExact(buf: ByteArray, offset: Int, count: Int): Int {
        var total = 0
        while (total < count) {
            val n = input.read(buf, offset + total, count - total)
            if (n <= 0) break
            total += n
        }
        return total
    }

    // ── Response header parser → (connectionId, body) ─────────────────────
    private fun parseResponseHeaders(pkt: ByteArray, start: Int): Pair<Long?, ByteArray?> {
        var connId: Long? = null
        var body: ByteArray? = null
        var i = start
        while (i < pkt.size) {
            val id = pkt[i].toInt() and 0xFF
            when (id shr 6) {
                0b11 -> { // 4-byte fixed (e.g. 0xCB Connection ID)
                    if (id == HDR_CONN_ID && i + 4 < pkt.size) {
                        connId = ((pkt[i + 1].toLong() and 0xFF) shl 24) or
                            ((pkt[i + 2].toLong() and 0xFF) shl 16) or
                            ((pkt[i + 3].toLong() and 0xFF) shl 8) or
                            (pkt[i + 4].toLong() and 0xFF)
                    }
                    i += 5
                }
                0b10 -> i += 2 // 1-byte fixed
                else -> { // variable length (unicode or byte sequence)
                    if (i + 2 >= pkt.size) break
                    val len = ((pkt[i + 1].toInt() and 0xFF) shl 8) or (pkt[i + 2].toInt() and 0xFF)
                    if (len < 3 || i + len > pkt.size) break
                    if (id == HDR_BODY || id == HDR_END_BODY) {
                        val chunk = pkt.copyOfRange(i + 3, i + len)
                        body = if (body == null) chunk else body + chunk
                    }
                    i += len
                }
            }
        }
        return Pair(connId, body)
    }

    // ── Header builders ───────────────────────────────────────────────────
    private fun nullTerminatedAscii(text: String): ByteArray {
        val raw = text.trimEnd('\u0000').toByteArray(Charsets.US_ASCII)
        return raw + 0x00
    }

    private fun byteSeqHeader(id: Int, data: ByteArray): ByteArray {
        val len = 3 + data.size
        val buf = ByteArray(len)
        buf[0] = id.toByte()
        buf[1] = (len shr 8).toByte()
        buf[2] = (len and 0xFF).toByte()
        data.copyInto(buf, 3)
        return buf
    }

    private fun unicodeHeader(id: Int, text: String): ByteArray =
        // OBEX unicode headers: UTF-16BE, null-terminated
        byteSeqHeader(id, (text + "\u0000").toByteArray(Charsets.UTF_16BE))

    private fun connIdHeader(value: Long): ByteArray = byteArrayOf(
        HDR_CONN_ID.toByte(),
        (value shr 24).toByte(), (value shr 16).toByte(),
        (value shr 8).toByte(), (value and 0xFF).toByte(),
    )
}
