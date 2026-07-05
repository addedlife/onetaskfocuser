package com.shamash.phonehost.store

import android.content.Context
import com.shamash.phonehost.CallDirection
import com.shamash.phonehost.CallRecord
import com.shamash.phonehost.ContactEntry
import com.shamash.phonehost.HostLog
import com.shamash.phonehost.MessageAttachment
import com.shamash.phonehost.PhoneUtil
import com.shamash.phonehost.SmsMessage
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Base64
import java.util.UUID

/**
 * JSON-file-backed stores for messages, calls, and contacts.
 * Same role as the Windows host's MessageStoreService / PbapCallLogStoreService /
 * ContactStoreService: survive restarts, seed MAP delta-sync with known handles.
 * All mutations are synchronized; saves are debounced via dirty-flag + flush().
 */
abstract class JsonStore(context: Context, fileName: String) {
    protected val file: File = File(context.filesDir, fileName)
    @Volatile private var dirty = false

    protected fun markDirty() { dirty = true }

    fun flushIfDirty() {
        if (!dirty) return
        dirty = false
        try {
            synchronized(this) { file.writeText(serialize()) }
        } catch (ex: Exception) {
            HostLog.add("[STORE] save ${file.name} failed: ${ex.message}")
        }
    }

    protected fun loadRaw(): String? = try {
        if (file.exists()) file.readText() else null
    } catch (ex: Exception) {
        HostLog.add("[STORE] load ${file.name} failed: ${ex.message}")
        null
    }

    protected abstract fun serialize(): String
}

class MessageStore(context: Context) : JsonStore(context, "messages.json") {
    private val messages = mutableListOf<SmsMessage>()

    init { load() }

    @Synchronized
    fun all(): List<SmsMessage> = messages.toList()

    @Synchronized
    fun knownHandles(): Set<String> =
        messages.mapNotNull { it.handle.ifBlank { null } }.toHashSet()

    @Synchronized
    fun count(): Int = messages.size

    /** Merge new/updated messages by handle (or localId). Returns number added. */
    @Synchronized
    fun merge(incoming: List<SmsMessage>): Int {
        var added = 0
        for (msg in incoming) {
            val existing = messages.firstOrNull {
                (msg.handle.isNotBlank() && it.handle == msg.handle) ||
                    (msg.localId != null && it.localId == msg.localId)
            }
            if (existing != null) {
                existing.isRead = msg.isRead
                if (msg.body.isNotBlank()) existing.body = msg.body
                if (msg.handle.isNotBlank()) existing.handle = msg.handle
            } else {
                messages.add(msg)
                added++
            }
        }
        if (incoming.isNotEmpty()) markDirty()
        return added
    }

    /** Local echo for an outgoing message before the phone assigns a handle. */
    @Synchronized
    fun addLocalSent(to: String, body: String, status: String): SmsMessage {
        val msg = SmsMessage(
            localId = "local-${UUID.randomUUID()}",
            from = "Me > $to",
            body = body,
            isSent = true,
            isRead = true,
            sendStatus = status,
        )
        messages.add(msg)
        markDirty()
        return msg
    }

    @Synchronized
    fun updateSendStatus(localId: String, status: String, handle: String? = null) {
        messages.firstOrNull { it.localId == localId }?.let {
            it.sendStatus = status
            if (handle != null && it.handle.isBlank()) it.handle = handle
            markDirty()
        }
    }

    @Synchronized
    fun applyReadStates(byHandle: Map<String, Boolean>): Boolean {
        var changed = false
        for (m in messages) {
            byHandle[m.handle]?.let { read ->
                if (m.isRead != read) { m.isRead = read; changed = true }
            }
        }
        if (changed) markDirty()
        return changed
    }

    @Synchronized
    fun markConversationRead(phone: String, read: Boolean): List<String> {
        val digits = PhoneUtil.normalize(phone)
        val touched = mutableListOf<String>()
        for (m in messages) {
            if (m.normalizedPhone == digits && !m.isSent && m.isRead != read) {
                m.isRead = read
                if (m.handle.isNotBlank()) touched.add(m.handle)
            }
        }
        if (touched.isNotEmpty()) markDirty()
        return touched
    }

    @Synchronized
    fun findByWebId(id: String): SmsMessage? =
        messages.firstOrNull { it.localId == id || it.handle == id }

    @Synchronized
    fun togglePin(id: String) {
        findByWebId(id)?.let { it.isPinned = !it.isPinned; markDirty() }
    }

    @Synchronized
    fun remove(id: String): SmsMessage? {
        val msg = findByWebId(id) ?: return null
        messages.remove(msg)
        markDirty()
        return msg
    }

    @Synchronized
    fun conversationCount(): Int =
        messages.map { it.normalizedPhone }.filter { it.isNotBlank() }.toHashSet().size

    private fun load() {
        val raw = loadRaw() ?: return
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val msg = SmsMessage(
                    handle = o.optString("handle"),
                    localId = o.optString("localId").ifBlank { null },
                    from = o.optString("from"),
                    body = o.optString("body"),
                    timestamp = o.optLong("timestamp", System.currentTimeMillis()),
                    isSent = o.optBoolean("isSent"),
                    isRead = o.optBoolean("isRead"),
                    isPinned = o.optBoolean("isPinned"),
                    isMms = o.optBoolean("isMms"),
                    sendStatus = o.optString("sendStatus"),
                    sourceDeviceAddress = o.optString("sourceDeviceAddress"),
                )
                val atts = o.optJSONArray("attachments")
                if (atts != null) {
                    for (j in 0 until atts.length()) {
                        val a = atts.getJSONObject(j)
                        try {
                            msg.attachments.add(
                                MessageAttachment(
                                    contentType = a.optString("contentType", "application/octet-stream"),
                                    fileName = a.optString("fileName", "attachment.bin"),
                                    data = Base64.getDecoder().decode(a.optString("data")),
                                ),
                            )
                        } catch (_: Exception) {}
                    }
                }
                messages.add(msg)
            }
            HostLog.add("[STORE] Loaded ${messages.size} messages")
        } catch (ex: Exception) {
            HostLog.add("[STORE] messages.json parse failed: ${ex.message}")
        }
    }

    @Synchronized
    override fun serialize(): String {
        val arr = JSONArray()
        for (m in messages) {
            val o = JSONObject()
            o.put("handle", m.handle)
            o.put("localId", m.localId ?: "")
            o.put("from", m.from)
            o.put("body", m.body)
            o.put("timestamp", m.timestamp)
            o.put("isSent", m.isSent)
            o.put("isRead", m.isRead)
            o.put("isPinned", m.isPinned)
            o.put("isMms", m.isMms)
            o.put("sendStatus", m.sendStatus)
            o.put("sourceDeviceAddress", m.sourceDeviceAddress)
            if (m.attachments.isNotEmpty()) {
                val atts = JSONArray()
                for (a in m.attachments) {
                    val ao = JSONObject()
                    ao.put("contentType", a.contentType)
                    ao.put("fileName", a.fileName)
                    ao.put("data", Base64.getEncoder().encodeToString(a.data))
                    atts.put(ao)
                }
                o.put("attachments", atts)
            }
            arr.put(o)
        }
        return arr.toString()
    }
}

class CallLogStore(context: Context) : JsonStore(context, "calls.json") {
    private val calls = mutableListOf<CallRecord>()

    init { load() }

    @Synchronized
    fun all(): List<CallRecord> = calls.sortedByDescending { it.time }

    /** Merge PBAP-imported entries; dedupe on number+minute+direction. */
    @Synchronized
    fun merge(incoming: List<CallRecord>): Int {
        var added = 0
        for (c in incoming) {
            val minute = c.time / 60_000
            val dup = calls.any {
                it.number == c.number && it.direction == c.direction && it.time / 60_000 == minute
            }
            if (!dup) { calls.add(c); added++ }
        }
        if (added > 0) markDirty()
        return added
    }

    /** Record a live HFP call as history when it ends. */
    @Synchronized
    fun addLive(number: String, direction: CallDirection, startTime: Long, durationSeconds: Int, deviceAddress: String) {
        calls.add(
            CallRecord(
                number = PhoneUtil.normalize(number),
                direction = direction,
                time = if (startTime > 0) startTime else System.currentTimeMillis(),
                durationSeconds = durationSeconds,
                isPhoneSynced = false,
                sourceDeviceAddress = deviceAddress,
                sourceObject = "live-hfp",
            ),
        )
        markDirty()
    }

    private fun load() {
        val raw = loadRaw() ?: return
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                calls.add(
                    CallRecord(
                        number = o.optString("number"),
                        name = o.optString("name").ifBlank { null },
                        direction = runCatching { CallDirection.valueOf(o.optString("direction", "Incoming")) }
                            .getOrDefault(CallDirection.Incoming),
                        time = o.optLong("time", System.currentTimeMillis()),
                        durationSeconds = o.optInt("durationSeconds"),
                        isPhoneSynced = o.optBoolean("isPhoneSynced"),
                        sourceDeviceAddress = o.optString("sourceDeviceAddress"),
                        rawTimestamp = o.optString("rawTimestamp"),
                        sourceObject = o.optString("sourceObject"),
                    ),
                )
            }
            HostLog.add("[STORE] Loaded ${calls.size} call records")
        } catch (ex: Exception) {
            HostLog.add("[STORE] calls.json parse failed: ${ex.message}")
        }
    }

    @Synchronized
    override fun serialize(): String {
        val arr = JSONArray()
        for (c in calls) {
            val o = JSONObject()
            o.put("number", c.number)
            o.put("name", c.name ?: "")
            o.put("direction", c.direction.name)
            o.put("time", c.time)
            o.put("durationSeconds", c.durationSeconds)
            o.put("isPhoneSynced", c.isPhoneSynced)
            o.put("sourceDeviceAddress", c.sourceDeviceAddress)
            o.put("rawTimestamp", c.rawTimestamp)
            o.put("sourceObject", c.sourceObject)
            arr.put(o)
        }
        return arr.toString()
    }
}

class ContactStore(context: Context) : JsonStore(context, "contacts.json") {
    private val contacts = mutableListOf<ContactEntry>()

    init { load() }

    @Synchronized
    fun all(): List<ContactEntry> = contacts.sortedBy { it.displayName.lowercase() }

    @Synchronized
    fun nameFor(number: String): String? {
        val digits = PhoneUtil.normalize(number)
        if (digits.isBlank()) return null
        return contacts.firstOrNull { c -> c.phoneNumbers.any { it == digits } }?.displayName
    }

    /** Replace-merge PBAP phonebook import; dedupe by name+primary number. */
    @Synchronized
    fun merge(incoming: List<ContactEntry>): Int {
        var added = 0
        for (c in incoming) {
            val existing = contacts.firstOrNull {
                it.displayName.equals(c.displayName, ignoreCase = true) &&
                    (it.primaryPhone == c.primaryPhone || it.phoneNumbers.any { p -> p in c.phoneNumbers })
            }
            if (existing != null) {
                for (p in c.phoneNumbers) if (p !in existing.phoneNumbers) existing.phoneNumbers.add(p)
            } else {
                contacts.add(c)
                added++
            }
        }
        if (incoming.isNotEmpty()) markDirty()
        return added
    }

    @Synchronized
    fun save(name: String, phone: String, deviceAddress: String) {
        val digits = PhoneUtil.normalize(phone)
        if (name.isBlank() || digits.isBlank()) return
        merge(listOf(ContactEntry(displayName = name, phoneNumbers = mutableListOf(digits), sourceDeviceAddress = deviceAddress, sourceFileName = "web-save")))
        markDirty()
    }

    @Synchronized
    fun delete(id: String, phone: String) {
        val digits = PhoneUtil.normalize(phone)
        val removed = contacts.removeAll { c ->
            val cid = "${c.sourceDeviceAddress}|${c.displayName}|${c.primaryPhone}"
            cid == id || (digits.isNotBlank() && c.phoneNumbers.contains(digits))
        }
        if (removed) markDirty()
    }

    private fun load() {
        val raw = loadRaw() ?: return
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                val phones = mutableListOf<String>()
                val pn = o.optJSONArray("phoneNumbers")
                if (pn != null) for (j in 0 until pn.length()) phones.add(pn.getString(j))
                contacts.add(
                    ContactEntry(
                        displayName = o.optString("displayName"),
                        phoneNumbers = phones,
                        sourceDeviceAddress = o.optString("sourceDeviceAddress"),
                        sourceFileName = o.optString("sourceFileName"),
                        importedAt = o.optLong("importedAt", System.currentTimeMillis()),
                    ),
                )
            }
            HostLog.add("[STORE] Loaded ${contacts.size} contacts")
        } catch (ex: Exception) {
            HostLog.add("[STORE] contacts.json parse failed: ${ex.message}")
        }
    }

    @Synchronized
    override fun serialize(): String {
        val arr = JSONArray()
        for (c in contacts) {
            val o = JSONObject()
            o.put("displayName", c.displayName)
            o.put("phoneNumbers", JSONArray(c.phoneNumbers))
            o.put("sourceDeviceAddress", c.sourceDeviceAddress)
            o.put("sourceFileName", c.sourceFileName)
            o.put("importedAt", c.importedAt)
            arr.put(o)
        }
        return arr.toString()
    }
}
