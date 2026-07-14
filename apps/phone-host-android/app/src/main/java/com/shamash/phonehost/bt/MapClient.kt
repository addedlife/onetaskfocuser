package com.shamash.phonehost.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import com.shamash.phonehost.HostLog
import com.shamash.phonehost.MessageAttachment
import com.shamash.phonehost.SmsMessage
import java.io.IOException
import java.util.Base64
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * MAP (Message Access Profile) client — port of the Windows host's MapService.
 * Connects to the phone's Message Access Server (MAS, UUID 0x1132) over RFCOMM,
 * speaks OBEX, and implements the same delta-sync strategy:
 *   initial: listing-only probe against seeded known handles, download only new bodies
 *   steady:  MaxListCount=1 newest-handle probe per folder; fetch 5 on change.
 */
@SuppressLint("MissingPermission")
class MapClient(private val log: (String) -> Unit = { HostLog.add(it) }) {

    companion object {
        val MAS_UUID: UUID = UUID.fromString("00001132-0000-1000-8000-00805F9B34FB")
    }

    var isConnected = false
        private set
    var onStatus: ((String) -> Unit)? = null

    private var socket: BluetoothSocket? = null
    private var obex: ObexClient? = null
    private var deviceAddress: String = ""

    // OBEX is strict request-response — one operation in flight at a time.
    private val obexLock = ReentrantLock()

    // Delta-sync state
    private var lastInboxHandle: String? = null
    private var lastSentHandle: String? = null
    private var isInitialSync = true
    private val seenHandles = HashSet<String>()

    class MsgMeta(
        val from: String = "",
        val to: String = "",
        val isRead: Boolean = false,
        val isSentFlag: Boolean = false,
        val timestamp: Long = System.currentTimeMillis(),
        val type: String = "",
    )

    // ── Connect ───────────────────────────────────────────────────────────
    fun connect(device: BluetoothDevice, maxAttempts: Int = 8) {
        onStatus?.invoke("Connecting MAP…")
        deviceAddress = device.address
        // MAP v1.2: MASInstanceID 0 (tag 0x0F)
        val connParams = byteArrayOf(0x0F, 0x01, 0x00)
        var ok = false
        var lastEx: Exception? = null

        for (attempt in 1..maxAttempts) {
            try {
                closeSocket()
                val s = device.createRfcommSocketToServiceRecord(MAS_UUID)
                s.connect()
                socket = s
                log("[MAP] RFCOMM connected (attempt $attempt)")
                val o = ObexClient(s.inputStream, s.outputStream, ObexClient.MAP_TARGET_UUID)
                ok = o.connect(connParams)
                if (ok) { obex = o; break }
                log("[MAP] OBEX CONNECT rejected (attempt $attempt/$maxAttempts) — waiting 5 s for phone to release old session…")
                onStatus?.invoke("MAP: waiting for phone to release session ($attempt/$maxAttempts)…")
            } catch (ex: Exception) {
                lastEx = ex
                log("[MAP] Connect attempt $attempt error: ${ex.message}")
            }
            if (attempt < maxAttempts) Thread.sleep(5000)
        }

        if (!ok) throw lastEx ?: IOException("OBEX CONNECT rejected by phone ($maxAttempts attempts)")
        isConnected = true
        onStatus?.invoke("MAP connected")
        log("[OBEX CONNECT OK] ConnID=${obex?.connectionId}")
    }

    fun disconnect() {
        try { obexLock.withLock { obex?.disconnect() } } catch (_: Exception) {}
        closeSocket()
        isConnected = false
        onStatus?.invoke("MAP disconnected")
    }

    private fun closeSocket() {
        try { socket?.close() } catch (_: Exception) {}
        socket = null
        obex = null
    }

    private fun markDisconnected(reason: String) {
        if (!isConnected) return
        isConnected = false
        log("[MAP] $reason")
        onStatus?.invoke("MAP disconnected")
    }

    /** Seed known handles from the local store so the first probe skips cached bodies. */
    fun seedKnownHandles(handles: Collection<String>) {
        var added = 0
        for (h in handles) if (h.isNotEmpty() && seenHandles.add(h)) added++
        log("[DELTA-SYNC] Loaded $added cached handles from local store (${seenHandles.size} known total)")
    }

    fun rememberKnownHandle(handle: String?) {
        if (!handle.isNullOrBlank()) seenHandles.add(handle)
    }

    // ── Delta sync ────────────────────────────────────────────────────────
    fun performDeltaSync(): List<SmsMessage> {
        obex ?: throw IllegalStateException("Not connected")

        if (isInitialSync) {
            isInitialSync = false
            log("[DELTA-SYNC] Initial listing probe (no body downloads)")

            val inboxListing: List<Pair<String, MsgMeta>>
            val sentListing: List<Pair<String, MsgMeta>>
            obexLock.withLock {
                inboxListing = getHandleListingCore("inbox", maxCount = 50)
                sentListing = getHandleListingCore("sent", maxCount = 50)
            }

            lastInboxHandle = inboxListing.firstOrNull()?.first
            lastSentHandle = sentListing.firstOrNull()?.first

            val newInbox = inboxListing.filter { it.first !in seenHandles }.take(5)
            val newSent = sentListing.filter { it.first !in seenHandles }.take(5)
            inboxListing.forEach { seenHandles.add(it.first) }
            sentListing.forEach { seenHandles.add(it.first) }

            if (newInbox.isEmpty() && newSent.isEmpty()) {
                log("[DELTA-SYNC] Initial probe — everything already in store, done")
                return emptyList()
            }

            log("[DELTA-SYNC] Initial probe: ${newInbox.size} new inbox, ${newSent.size} new sent — downloading bodies")
            val results = mutableListOf<SmsMessage>()
            for ((handle, meta) in newInbox) {
                try {
                    obexLock.withLock {
                        val msg = getMessage(handle, isMms = meta.type == "MMS")
                        msg.from = meta.from; msg.timestamp = meta.timestamp; msg.isRead = meta.isRead
                        results.add(msg)
                    }
                } catch (ex: Exception) { log("[DELTA-SYNC] inbox $handle failed: ${ex.message}") }
                Thread.sleep(20)
            }
            for ((handle, meta) in newSent) {
                try {
                    obexLock.withLock {
                        val msg = getMessage(handle, isMms = meta.type == "MMS")
                        val recipient = meta.to.ifEmpty { meta.from }
                        msg.from = "Me > $recipient"; msg.isSent = true
                        msg.timestamp = meta.timestamp; msg.isRead = meta.isRead
                        results.add(msg)
                    }
                } catch (ex: Exception) { log("[DELTA-SYNC] sent $handle failed: ${ex.message}") }
                Thread.sleep(20)
            }
            log("[DELTA-SYNC] Initial complete (${results.size} new messages)")
            return results
        }

        // Steady state: newest-handle probe in both folders
        val (probeInbox, probeSent, failures) = probeBothFolders()
        if (failures >= 2) {
            markDisconnected("Both MAP folder probes failed; marking message sync disconnected.")
            throw IOException("MAP message sync stopped responding.")
        }

        val inboxChanged = probeInbox != null && probeInbox != lastInboxHandle
        val sentChanged = probeSent != null && probeSent != lastSentHandle
        if (!inboxChanged && !sentChanged) return emptyList()

        val results = mutableListOf<SmsMessage>()
        if (inboxChanged) {
            log("[DELTA-SYNC] Inbox changed ($lastInboxHandle → $probeInbox), fetching 5")
            val msgs = getFolder("inbox", 5)
            val newOnes = msgs.filter { it.handle !in seenHandles }
            newOnes.forEach { seenHandles.add(it.handle) }
            results.addAll(newOnes.ifEmpty { msgs })
            lastInboxHandle = probeInbox
        }
        if (sentChanged) {
            log("[DELTA-SYNC] Sent changed ($lastSentHandle → $probeSent), fetching 5")
            val msgs = getFolder("sent", 5)
            val newOnes = msgs.filter { it.handle !in seenHandles }
            newOnes.forEach { seenHandles.add(it.handle) }
            results.addAll(newOnes.ifEmpty { msgs })
            lastSentHandle = probeSent
        }
        log("[DELTA-SYNC] Change sync complete (${results.size} new/updated messages)")
        return results
    }

    private fun probeBothFolders(): Triple<String?, String?, Int> {
        val o = obex ?: return Triple(null, null, 2)
        obexLock.withLock {
            val appParams = byteArrayOf(0x01, 0x02, 0x00, 0x01) // MaxListCount=1
            var failures = 0

            var inboxHandle: String? = null
            try {
                navigateTo(o, "inbox")
                var xml = o.get("x-bt/MAP-msg-listing", null, appParams)
                if (xml.isEmpty()) xml = o.get("x-bt/MAP-msg-listing", null, null)
                inboxHandle = parseMessageListing(String(xml, Charsets.UTF_8)).firstOrNull()?.first
            } catch (ex: Exception) { failures++; log("[PROBE inbox] ${ex.message}") }

            var sentHandle: String? = null
            try {
                navigateTo(o, "sent")
                var xml = o.get("x-bt/MAP-msg-listing", null, appParams)
                if (xml.isEmpty()) xml = o.get("x-bt/MAP-msg-listing", null, null)
                sentHandle = parseMessageListing(String(xml, Charsets.UTF_8)).firstOrNull()?.first
            } catch (ex: Exception) { failures++; log("[PROBE sent] ${ex.message}") }

            return Triple(inboxHandle, sentHandle, failures)
        }
    }

    private fun navigateTo(o: ObexClient, folder: String) {
        o.setPath("")
        o.setPath("telecom")
        o.setPath("msg")
        o.setPath(folder)
    }

    // ── Paginated full-history loader ─────────────────────────────────────
    // Interleaves inbox/sent listing pages with body downloads so history
    // streams in without blocking real-time sends/polls (per-item locking).
    fun fullHistoryLoad(
        knownHandles: Set<String>,
        isPaused: () -> Boolean,
        onBatch: (List<SmsMessage>) -> Unit,
        isCancelled: () -> Boolean = { false },
    ) {
        if (obex == null) return
        log("[FULLHIST] Starting paginated history load")

        val pageSize = 50
        val batchSize = 25
        var totalDownloaded = 0
        val batchBuffer = mutableListOf<SmsMessage>()

        fun flushBatch() {
            if (batchBuffer.isEmpty()) return
            log("[FULLHIST] Batch: ${batchBuffer.size} msgs (total $totalDownloaded)")
            onBatch(batchBuffer.toList())
            batchBuffer.clear()
        }

        val folders = arrayOf("inbox", "sent")
        val offsets = intArrayOf(0, 0)
        val seenPage = Array(folders.size) { HashSet<String>() }
        val done = booleanArrayOf(false, false)

        try {
            while (!done.all { it } && !isCancelled()) {
                for (fi in folders.indices) {
                    if (done[fi] || isCancelled()) continue
                    while (isPaused()) Thread.sleep(300)

                    val folder = folders[fi]
                    val page = obexLock.withLock {
                        getHandleListingCore(folder, maxCount = pageSize, offset = offsets[fi])
                    }
                    if (page.isEmpty()) { done[fi] = true; continue }

                    val newInPage = page.filter { it.first !in seenPage[fi] }
                    if (newInPage.isEmpty()) {
                        log("[FULLHIST] $folder: repeated page at offset ${offsets[fi]}, stopping folder")
                        done[fi] = true
                        continue
                    }
                    newInPage.forEach { seenPage[fi].add(it.first) }
                    offsets[fi] += page.size
                    log("[FULLHIST] $folder: page +${newInPage.size} (total ${offsets[fi]})")
                    if (page.size < pageSize) done[fi] = true

                    val unknown = newInPage.filter { it.first.isNotEmpty() && it.first !in knownHandles }
                    if (unknown.isEmpty()) { Thread.sleep(250); continue }

                    for ((handle, meta) in unknown) {
                        if (isCancelled()) return
                        while (isPaused()) Thread.sleep(300)
                        try {
                            obexLock.withLock {
                                val msg = getMessage(handle, isMms = meta.type == "MMS")
                                if (folder == "sent" || meta.isSentFlag) {
                                    val recipient = meta.to.ifEmpty { meta.from }
                                    msg.from = "Me > $recipient"; msg.isSent = true
                                } else {
                                    msg.from = meta.from; msg.isSent = meta.isSentFlag
                                }
                                msg.timestamp = meta.timestamp; msg.isRead = meta.isRead
                                seenHandles.add(handle)
                                batchBuffer.add(msg)
                                totalDownloaded++
                            }
                        } catch (ex: Exception) { log("[FULLHIST] $handle failed: ${ex.message}") }
                        Thread.sleep(50)
                        if (batchBuffer.size >= batchSize) flushBatch()
                    }
                    Thread.sleep(100)
                }
            }
            flushBatch()
        } catch (ex: Exception) {
            log("[FULLHIST] Error: ${ex.message}")
            flushBatch()
            return
        }
        log(if (totalDownloaded == 0) "[FULLHIST] No unknown handles — already have full history"
            else "[FULLHIST] Complete — $totalDownloaded messages downloaded")
    }

    // Lock must be held by caller.
    private fun getHandleListingCore(
        folderName: String,
        maxCount: Int = 0xFFFF,
        offset: Int = 0,
    ): List<Pair<String, MsgMeta>> {
        val o = obex ?: throw IllegalStateException("Not connected")
        navigateTo(o, folderName)

        val appParams = if (offset > 0) byteArrayOf(
            0x01, 0x02, (maxCount shr 8).toByte(), (maxCount and 0xFF).toByte(), // MaxListCount
            0x02, 0x02, (offset shr 8).toByte(), (offset and 0xFF).toByte(),     // ListStartOffset
        ) else byteArrayOf(
            0x01, 0x02, (maxCount shr 8).toByte(), (maxCount and 0xFF).toByte(),
        )

        var xml = o.get("x-bt/MAP-msg-listing", null, appParams)
        if (xml.isEmpty()) xml = o.get("x-bt/MAP-msg-listing", null, null)
        return parseMessageListing(String(xml, Charsets.UTF_8))
    }

    // ── Folder fetch (listing under one lock, bodies under per-item locks) ─
    fun getFolder(folderName: String, maxCount: Int, skipHandles: Set<String>? = null): List<SmsMessage> {
        if (obex == null) throw IllegalStateException("Not connected")

        val handles = obexLock.withLock { getHandleListingCore(folderName, maxCount = maxCount) }
        log("[${folderName.uppercase()} listing] ${handles.size} handles, taking $maxCount")

        val isSent = folderName.equals("sent", ignoreCase = true)
        val messages = mutableListOf<SmsMessage>()
        for ((handle, meta) in handles.take(maxCount)) {
            if (skipHandles?.contains(handle) == true) continue
            try {
                obexLock.withLock {
                    val body = getMessage(handle, isMms = meta.type == "MMS")
                    if (isSent) {
                        val recipient = meta.to.ifEmpty { meta.from }
                        body.from = "Me > $recipient"; body.isSent = true
                    } else {
                        body.from = meta.from; body.isSent = meta.isSentFlag
                    }
                    body.timestamp = meta.timestamp
                    body.isRead = meta.isRead
                    messages.add(body)
                }
            } catch (ex: Exception) { log("[MSG $handle FAIL — ${ex.message}]") }
            Thread.sleep(30)
        }
        return messages
    }

    /** Newest handle in sent — used to tag a just-sent local copy for dedup. */
    fun getNewestSentHandle(): String? {
        val o = obex ?: return null
        return try {
            obexLock.withLock {
                navigateTo(o, "sent")
                val appParams = byteArrayOf(0x01, 0x02, 0x00, 0x01)
                var xml = o.get("x-bt/MAP-msg-listing", null, appParams)
                if (xml.isEmpty()) xml = o.get("x-bt/MAP-msg-listing", null, null)
                parseMessageListing(String(xml, Charsets.UTF_8)).firstOrNull()?.first
            }
        } catch (_: Exception) { null }
    }

    /** Recent read-state window so read/unread changes on the phone flow back. */
    fun getRecentReadStatesByHandle(maxPerFolder: Int = 25): Map<String, Boolean> {
        if (obex == null) throw IllegalStateException("Not connected")
        obexLock.withLock {
            val byHandle = HashMap<String, Boolean>()
            for (folder in arrayOf("inbox", "sent")) {
                for ((handle, meta) in getHandleListingCore(folder, maxCount = maxPerFolder)) {
                    if (handle.isBlank()) continue
                    byHandle[handle] = if (meta.isSentFlag) true else meta.isRead
                }
            }
            return byHandle
        }
    }

    // ── MNS registration ──────────────────────────────────────────────────
    fun registerForNotifications(enable: Boolean): Boolean {
        val o = obex ?: return false
        val appParams = byteArrayOf(0x0E, 0x01, if (enable) 0x01 else 0x00)
        return try {
            obexLock.withLock {
                val code = o.put(
                    "x-bt/MAP-NotificationRegistration",
                    name = null,
                    body = byteArrayOf(0x30),
                    appParams = appParams,
                )
                val ok = code == ObexClient.RES_OK
                log(if (ok) "[MNS] Notification registration ${if (enable) "enabled" else "disabled"}"
                    else "[MNS] Notification registration rejected: 0x%02X".format(code))
                ok
            }
        } catch (ex: Exception) {
            log("[MNS] Notification registration failed: ${ex.message}")
            false
        }
    }

    // ── Read / deleted status pushback ────────────────────────────────────
    fun setMessageReadStatus(handle: String, isRead: Boolean): Boolean =
        setMessageStatus(handle, 0x00, isRead, "READSTATE")

    fun setMessageDeletedStatus(handle: String, isDeleted: Boolean): Boolean =
        setMessageStatus(handle, 0x01, isDeleted, "DELETE")

    private fun setMessageStatus(handle: String, indicator: Int, enabled: Boolean, label: String): Boolean {
        val o = obex ?: throw IllegalStateException("Not connected")
        if (handle.isBlank()) return false
        obexLock.withLock {
            o.setPath("")
            o.setPath("telecom")
            o.setPath("msg")
            val appParams = byteArrayOf(
                0x17, 0x01, indicator.toByte(),
                0x18, 0x01, if (enabled) 0x01 else 0x00,
            )
            val code = o.put("x-bt/messageStatus", handle, byteArrayOf(0x30), appParams)
            val ok = code == ObexClient.RES_OK
            log(if (ok) "[MAP $label OK] $handle => $enabled" else "[MAP $label FAIL] $handle (0x%02X)".format(code))
            return ok
        }
    }

    // ── Send SMS/MMS via MAP PushMessage ──────────────────────────────────
    fun sendMessage(toNumber: String, text: String, attachments: List<MessageAttachment> = emptyList()): Boolean {
        val o = obex ?: throw IllegalStateException("Not connected")
        obexLock.withLock {
            log("[MAP SEND] → $toNumber")
            o.setPath("")
            o.setPath("telecom")
            o.setPath("msg")

            // PushMessage app params (MAP spec §3.1.3.3):
            // Transparent=0 (save to Sent), Retry=1, Charset=UTF-8
            val appParams = byteArrayOf(
                0x0C, 0x01, 0x00,
                0x0D, 0x01, 0x01,
                0x14, 0x01, 0x01,
            )

            val hasAttachments = attachments.isNotEmpty()
            val types = if (hasAttachments) arrayOf("MMS") else arrayOf("SMS_GSM", "SMS_CDMA", "MMS")
            for (msgType in types) {
                val bytes = if (hasAttachments) buildMmsBMessage(toNumber, text, attachments)
                            else buildBMessage(toNumber, text, msgType).toByteArray(Charsets.UTF_8)
                log("[MAP SEND bMessage type=$msgType (${bytes.size} bytes)]")

                val code = o.put("x-bt/message", "outbox", bytes, appParams)
                if (code == ObexClient.RES_OK) {
                    log("[MAP SEND OK type=$msgType]")
                    return true
                }
                val reason = when (code) {
                    0xC0 -> "Bad Request (0xC0) — bMessage format rejected by phone"
                    0xC1 -> "Unauthorized (0xC1) — phone requires MAP notification registration first"
                    0xC3 -> "Forbidden (0xC3) — phone refused; content restrictions may block sending"
                    0xC4 -> "Not Found (0xC4) — outbox folder not found"
                    0xC6 -> "Not Acceptable (0xC6) — phone rejected message type or content"
                    0xD3 -> "Not Implemented (0xD3) — phone MAP server does not support PushMessage"
                    0x00 -> "No response — Bluetooth stream closed"
                    else -> "OBEX error 0x%02X".format(code)
                }
                log("[MAP SEND FAILED type=$msgType] $reason")
                // Only retry a different type on Not Acceptable (0xC6)
                if (code != 0xC6) break
            }
            return false
        }
    }

    // bMessage envelope per MAP spec §5.2.2 — recipient VCARD INSIDE BENV.
    private fun buildBMessage(toNumber: String, text: String, msgType: String): String {
        val msgSection = "BEGIN:MSG\r\n$text\r\nEND:MSG\r\n"
        val length = msgSection.toByteArray(Charsets.UTF_8).size
        return "BEGIN:BMSG\r\n" +
            "VERSION:1.0\r\n" +
            "STATUS:UNREAD\r\n" +
            "TYPE:$msgType\r\n" +
            "FOLDER:telecom/msg/outbox\r\n" +
            "BEGIN:BENV\r\n" +
            "BEGIN:VCARD\r\n" +
            "VERSION:2.1\r\n" +
            "TEL:$toNumber\r\n" +
            "END:VCARD\r\n" +
            "BEGIN:BBODY\r\n" +
            "CHARSET:UTF-8\r\n" +
            "ENCODING:8BIT\r\n" +
            "LENGTH:$length\r\n" +
            msgSection +
            "END:BBODY\r\n" +
            "END:BENV\r\n" +
            "END:BMSG\r\n"
    }

    private fun buildMmsBMessage(toNumber: String, text: String, attachments: List<MessageAttachment>): ByteArray {
        val boundary = "phonehost-${UUID.randomUUID().toString().replace("-", "")}"
        val mime = StringBuilder()
        mime.append("Content-Type: multipart/mixed; boundary=\"$boundary\"\r\n")
        mime.append("MIME-Version: 1.0\r\n\r\n")
        if (text.isNotBlank()) {
            mime.append("--$boundary\r\n")
            mime.append("Content-Type: text/plain; charset=utf-8\r\n")
            mime.append("Content-Transfer-Encoding: 8bit\r\n\r\n")
            mime.append(text).append("\r\n")
        }
        for (a in attachments) {
            val safeName = a.fileName.replace("\"", "")
            mime.append("--$boundary\r\n")
            mime.append("Content-Type: ${a.contentType}; name=\"$safeName\"\r\n")
            mime.append("Content-Transfer-Encoding: base64\r\n")
            mime.append("Content-Disposition: attachment; filename=\"$safeName\"\r\n\r\n")
            mime.append(wrapBase64(Base64.getEncoder().encodeToString(a.data))).append("\r\n")
        }
        mime.append("--$boundary--\r\n")

        val mimeBytes = mime.toString().toByteArray(Charsets.UTF_8)
        val length = mimeBytes.size + "BEGIN:MSG\r\nEND:MSG\r\n".toByteArray(Charsets.UTF_8).size
        val prefix = ("BEGIN:BMSG\r\n" +
            "VERSION:1.0\r\n" +
            "STATUS:UNREAD\r\n" +
            "TYPE:MMS\r\n" +
            "FOLDER:telecom/msg/outbox\r\n" +
            "BEGIN:BENV\r\n" +
            "BEGIN:VCARD\r\n" +
            "VERSION:2.1\r\n" +
            "TEL:$toNumber\r\n" +
            "END:VCARD\r\n" +
            "BEGIN:BBODY\r\n" +
            "ENCODING:8BIT\r\n" +
            "LENGTH:$length\r\n" +
            "BEGIN:MSG\r\n").toByteArray(Charsets.UTF_8)
        val suffix = "\r\nEND:MSG\r\nEND:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n".toByteArray(Charsets.UTF_8)
        return prefix + mimeBytes + suffix
    }

    private fun wrapBase64(value: String): String {
        val sb = StringBuilder(value.length + value.length / 76 * 2 + 2)
        var i = 0
        while (i < value.length) {
            val end = minOf(i + 76, value.length)
            sb.append(value, i, end).append("\r\n")
            i = end
        }
        return sb.toString()
    }

    // ── Fetch one message by handle (lock must be held) ───────────────────
    fun fetchHandle(handle: String, isMms: Boolean): SmsMessage =
        obexLock.withLock { getMessage(handle, isMms) }

    private fun getMessage(handle: String, isMms: Boolean): SmsMessage {
        val o = obex ?: throw IllegalStateException("Not connected")
        val appParams = if (isMms) byteArrayOf(0x0A, 0x01, 0x01) // Attachment=Yes
                        else byteArrayOf(0x0A, 0x01, 0x00, 0x14, 0x01, 0x01) // Attachment=No, UTF-8

        var raw = o.get("x-bt/message", handle, appParams)
        if (raw.isEmpty()) raw = o.get("x-bt/message", handle, null)
        return parseBMessage(raw, handle)
    }

    // ── bMessage parser ───────────────────────────────────────────────────
    private fun parseBMessage(rawBytes: ByteArray, handle: String): SmsMessage {
        val msg = SmsMessage(handle = handle, sourceDeviceAddress = deviceAddress)
        val bmsg = String(rawBytes, Charsets.UTF_8)

        val beginTag = "BEGIN:MSG".toByteArray(Charsets.US_ASCII)
        val endTag = "END:MSG".toByteArray(Charsets.US_ASCII)
        val startIdx = indexOf(rawBytes, beginTag, 0)
        val isMms = bmsg.contains("TYPE:MMS", ignoreCase = true)
        msg.isMms = isMms

        if (startIdx >= 0) {
            var afterBegin = startIdx + beginTag.size
            if (afterBegin < rawBytes.size && rawBytes[afterBegin] == '\r'.code.toByte()) afterBegin++
            if (afterBegin < rawBytes.size && rawBytes[afterBegin] == '\n'.code.toByte()) afterBegin++
            val endIdx = indexOf(rawBytes, endTag, afterBegin)
            if (endIdx > afterBegin) {
                val bodyBytes = rawBytes.copyOfRange(afterBegin, endIdx)
                if (isMms) parseMimeParts(bodyBytes, msg)
                else msg.body = cleanMessageBody(String(bodyBytes, Charsets.UTF_8).trim())
                return msg
            }
        }

        // Raw MIME without a bMessage wrapper (Fig 52)
        if (bmsg.contains("multipart", ignoreCase = true) || bmsg.contains("vnd.wap", ignoreCase = true)) {
            msg.isMms = true
            parseMimeParts(rawBytes, msg)
            return msg
        }

        msg.body = cleanMessageBody(bmsg.trim())
        return msg
    }

    private fun cleanMessageBody(body: String): String {
        if (body.isBlank()) return body
        // Strip carrier bug: ~ followed by exactly 15 alphanumerics at end
        return body.replace(Regex("~[a-zA-Z0-9]{15}\\s*$"), "").trim()
    }

    private fun indexOf(haystack: ByteArray, needle: ByteArray, startAt: Int): Int {
        outer@ for (i in startAt..haystack.size - needle.size) {
            for (j in needle.indices) if (haystack[i + j] != needle[j]) continue@outer
            return i
        }
        return -1
    }

    // ── MIME multipart parser for MMS bodies ──────────────────────────────
    private fun parseMimeParts(mimeBytes: ByteArray, msg: SmsMessage) {
        val mime = String(mimeBytes, Charsets.ISO_8859_1)
        val boundaryMatch = Regex(
            "[Cc]ontent-[Tt]ype\\s*:.*?boundary=\"?([^\"\\r\\n;]+)\"?",
            RegexOption.DOT_MATCHES_ALL,
        ).find(mime)

        if (boundaryMatch == null) {
            extractPayloadFromPart(mime, msg)
            return
        }

        val boundary = "--" + boundaryMatch.groupValues[1].trim()
        val parts = mime.split(boundary).filter { it.isNotEmpty() }
        for (part in parts) {
            if (part.trimStart().startsWith("--") || part.trim() == "--") continue
            extractPayloadFromPart(part, msg)
        }

        if (msg.attachments.isEmpty() && msg.body.isEmpty()) {
            msg.body = "[MMS — content format not recognized]"
        }
    }

    private fun extractPayloadFromPart(part: String, msg: SmsMessage) {
        var headerEnd = part.indexOf("\r\n\r\n")
        var sepLen = 4
        if (headerEnd < 0) { headerEnd = part.indexOf("\n\n"); sepLen = 2 }
        if (headerEnd < 0) { headerEnd = 0; sepLen = 0 }

        val headers = part.substring(0, headerEnd)
        val bodyOffset = headerEnd + sepLen

        val contentType = Regex("[Cc]ontent-[Tt]ype\\s*:\\s*([^\\r\\n;]+)")
            .find(headers)?.groupValues?.get(1)?.trim()?.lowercase() ?: ""
        val encoding = Regex("[Cc]ontent-[Tt]ransfer-[Ee]ncoding\\s*:\\s*([^\\r\\n]+)")
            .find(headers)?.groupValues?.get(1)?.trim()?.lowercase() ?: ""

        val partBytes = part.toByteArray(Charsets.ISO_8859_1)

        // ── Image part ────────────────────────────────────────────────────
        if (contentType.startsWith("image/") || isImageMagic(partBytes, bodyOffset)) {
            var imageBytes: ByteArray? = null
            if (encoding == "base64") {
                var b64 = part.substring(minOf(bodyOffset, part.length)).trim().replace(Regex("\\s+"), "")
                val term = b64.indexOf("--")
                if (term > 0) b64 = b64.substring(0, term)
                imageBytes = try { Base64.getDecoder().decode(b64) } catch (_: Exception) { null }
            } else if (bodyOffset < partBytes.size) {
                imageBytes = partBytes.copyOfRange(bodyOffset, partBytes.size)
            }
            if (imageBytes != null && isImageMagic(imageBytes, 0)) {
                msg.attachments.add(
                    MessageAttachment(
                        contentType = contentType.ifBlank { guessImageContentType(imageBytes) },
                        fileName = extractMimeFileName(headers, contentType, msg.attachments.size + 1),
                        data = imageBytes,
                    ),
                )
            }
            return
        }

        // ── Text part ─────────────────────────────────────────────────────
        if (contentType.startsWith("text/plain") && msg.body.isEmpty()) {
            val bodyStr = part.substring(minOf(bodyOffset, part.length)).trim()
            if (!bodyStr.startsWith("<smil", ignoreCase = true)) msg.body = cleanMessageBody(bodyStr)
            return
        }

        // ── Non-image attachment ──────────────────────────────────────────
        if (contentType.isNotBlank() &&
            !contentType.startsWith("multipart/") &&
            !contentType.contains("smil")
        ) {
            val bytes = decodeAttachmentBytes(part, partBytes, bodyOffset, encoding)
            if (bytes.isNotEmpty()) {
                msg.attachments.add(
                    MessageAttachment(
                        contentType = contentType,
                        fileName = extractMimeFileName(headers, contentType, msg.attachments.size + 1),
                        data = bytes,
                    ),
                )
                return
            }
        }

        // ── Fallback base64 image scan ────────────────────────────────────
        if (!msg.hasImageAttachment) {
            for (m in Regex("([A-Za-z0-9+/=]{60,}(?:\\s+[A-Za-z0-9+/=]{10,})*)").findAll(part)) {
                try {
                    var b64 = m.groupValues[1].replace(Regex("\\s+"), "")
                    while (b64.length % 4 != 0) b64 += "="
                    val bytes = Base64.getDecoder().decode(b64)
                    if (isImageMagic(bytes, 0)) {
                        msg.attachments.add(
                            MessageAttachment(
                                contentType = guessImageContentType(bytes),
                                fileName = extractMimeFileName(headers, guessImageContentType(bytes), msg.attachments.size + 1),
                                data = bytes,
                            ),
                        )
                        return
                    }
                } catch (_: Exception) {}
            }
        }
    }

    private fun decodeAttachmentBytes(part: String, partBytes: ByteArray, bodyOffset: Int, encoding: String): ByteArray {
        if (bodyOffset < 0) return ByteArray(0)
        if (encoding == "base64") {
            return try {
                var b64 = part.substring(minOf(bodyOffset, part.length)).trim().replace(Regex("\\s+"), "")
                while (b64.length % 4 != 0) b64 += "="
                Base64.getDecoder().decode(b64)
            } catch (_: Exception) { ByteArray(0) }
        }
        return if (bodyOffset >= partBytes.size) ByteArray(0) else partBytes.copyOfRange(bodyOffset, partBytes.size)
    }

    private fun isImageMagic(data: ByteArray, offset: Int): Boolean {
        if (data.size - offset < 4) return false
        val b0 = data[offset].toInt() and 0xFF
        val b1 = data[offset + 1].toInt() and 0xFF
        val b2 = data[offset + 2].toInt() and 0xFF
        val b3 = data[offset + 3].toInt() and 0xFF
        return (b0 == 0xFF && b1 == 0xD8 && b2 == 0xFF) ||                 // JPEG
            (b0 == 0x89 && b1 == 0x50 && b2 == 0x4E && b3 == 0x47) ||      // PNG
            (b0 == 0x47 && b1 == 0x49 && b2 == 0x46 && b3 == 0x38) ||      // GIF
            (b0 == 0x52 && b1 == 0x49 && b2 == 0x46 && b3 == 0x46)         // WebP (RIFF)
    }

    private fun guessImageContentType(data: ByteArray): String = when {
        data.size >= 4 && data[0].toInt() and 0xFF == 0x89 && data[1].toInt() == 0x50 -> "image/png"
        data.size >= 4 && data[0].toInt() == 0x47 && data[1].toInt() == 0x49 -> "image/gif"
        data.size >= 4 && data[0].toInt() == 0x52 && data[1].toInt() == 0x49 -> "image/webp"
        else -> "image/jpeg"
    }

    private fun extractMimeFileName(headers: String, contentType: String, partNumber: Int): String {
        var fileName = Regex("[Ff]ilename=\"?([^\"\\r\\n;]+)\"?").find(headers)?.groupValues?.get(1)?.trim() ?: ""
        if (fileName.isBlank()) {
            fileName = Regex("[Nn]ame=\"?([^\"\\r\\n;]+)\"?").find(headers)?.groupValues?.get(1)?.trim() ?: ""
        }
        if (fileName.isNotBlank()) return fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_")
        val ext = when {
            contentType.contains("png") -> "png"
            contentType.contains("gif") -> "gif"
            contentType.contains("webp") -> "webp"
            contentType.contains("jpeg") || contentType.contains("jpg") -> "jpg"
            contentType.contains("vcard") -> "vcf"
            contentType.contains("pdf") -> "pdf"
            contentType.contains("plain") -> "txt"
            else -> "bin"
        }
        return "MMS_attachment_%02d.%s".format(partNumber, ext)
    }

    // ── Message-listing XML parser ────────────────────────────────────────
    // Attribute-regex parser (lenient — some phones emit non-wellformed XML).
    private fun parseMessageListing(xml: String): List<Pair<String, MsgMeta>> {
        val result = mutableListOf<Pair<String, MsgMeta>>()
        if (!xml.trimStart().startsWith("<")) return result
        for (m in Regex("<msg\\s+([^>]*)/?>", RegexOption.IGNORE_CASE).findAll(xml)) {
            val attrs = HashMap<String, String>()
            for (a in Regex("([a-zA-Z_]+)\\s*=\\s*\"([^\"]*)\"").findAll(m.groupValues[1])) {
                attrs[a.groupValues[1].lowercase()] = a.groupValues[2]
            }
            val handle = attrs["handle"] ?: continue
            if (handle.isEmpty()) continue
            result.add(
                Pair(
                    handle,
                    MsgMeta(
                        from = decodeXmlEntities(attrs["sender_addressing"] ?: ""),
                        to = decodeXmlEntities(attrs["recipient_addressing"] ?: ""),
                        isRead = attrs["read"] == "yes",
                        isSentFlag = attrs["sent"] == "yes",
                        timestamp = parseMapDate(attrs["datetime"]),
                        type = attrs["type"] ?: "",
                    ),
                ),
            )
        }
        return result
    }

    private fun decodeXmlEntities(s: String): String = s
        .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        .replace("&quot;", "\"").replace("&apos;", "'")

    private fun parseMapDate(s: String?): Long = ObexDateTime.parse(s) ?: System.currentTimeMillis()
}
