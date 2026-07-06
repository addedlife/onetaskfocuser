package com.shamash.phonehost.api

import com.shamash.phonehost.CallDirection
import com.shamash.phonehost.CallRecord
import com.shamash.phonehost.ContactEntry
import com.shamash.phonehost.SmsMessage
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale

/**
 * JSON builders matching the Windows host's /status /messages /calls /contacts
 * payloads (MainViewModel _api.Get* + MapCallRecordForApi) so the web surfaces
 * work against this host unchanged.
 */
object ApiJson {

    // Windows serializes .NET DateTime as ISO-8601 local time — match it.
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)

    fun isoTime(epochMs: Long): String = synchronized(iso) { iso.format(Date(epochMs)) }

    fun mediaId(data: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(data)
        return digest.joinToString("") { "%02x".format(it) }.take(24)
    }

    fun message(m: SmsMessage, contactName: (String) -> String?, includeAttachmentData: Boolean): JSONObject {
        val o = JSONObject()
        o.put("id", m.localId ?: m.handle)
        o.put("handle", m.handle)
        o.put("from", if (m.isSent) "Me" else m.from)
        o.put("to", if (m.isSent) m.normalizedPhone else "")
        o.put("number", m.normalizedPhone)
        o.put("body", m.body)
        o.put("preview", m.previewBody)
        o.put("timestamp", isoTime(m.timestamp))
        o.put("isSent", m.isSent)
        o.put("isRead", m.isRead)
        o.put("isPinned", m.isPinned)
        o.put("pinActionLabel", if (m.isPinned) "Unpin" else "Pin")
        o.put("sendStatus", m.sendStatus)
        o.put("sendStatusLabel", sendStatusLabel(m.sendStatus))
        o.put("outgoingStatusLabel", if (m.isSent) sendStatusLabel(m.sendStatus) else "")
        o.put("outgoingStatusIcon", if (m.isSent) sendStatusIcon(m.sendStatus) else "")
        o.put("sourceDeviceAddress", m.sourceDeviceAddress)
        o.put("isMms", m.isMms)
        val atts = JSONArray()
        for (a in m.attachments) {
            val ao = JSONObject()
            ao.put("fileName", a.fileName)
            ao.put("contentType", a.contentType)
            ao.put("isImage", a.isImage)
            ao.put("isContactCard", a.isContactCard)
            ao.put("size", a.data.size)
            ao.put("mediaId", if (a.isImage && a.data.isNotEmpty()) mediaId(a.data) else JSONObject.NULL)
            ao.put(
                "dataUrl",
                if (includeAttachmentData && a.isImage && a.data.isNotEmpty())
                    "data:${a.contentType};base64,${Base64.getEncoder().encodeToString(a.data)}"
                else JSONObject.NULL,
            )
            atts.put(ao)
        }
        o.put("attachments", atts)
        return o
    }

    fun call(c: CallRecord, contactName: (String) -> String?): JSONObject {
        val o = JSONObject()
        o.put("id", "${c.sourceDeviceAddress}|${c.number}|${c.time}|${c.direction.name}")
        o.put("number", c.number)
        o.put("name", c.name ?: contactName(c.number) ?: "")
        o.put("displayName", formatPhoneDisplay(c.number))
        o.put("direction", c.direction.name)
        o.put("directionLabel", c.directionLabel)
        o.put("time", isoTime(c.time))
        o.put("timestamp", isoTime(c.time))
        o.put("timeDisplay", timeDisplay(c.time))
        o.put("durationSeconds", c.durationSeconds)
        o.put("durationDisplay", durationDisplay(c.durationSeconds))
        o.put("subtitle", "${c.directionLabel} · ${timeDisplay(c.time)}")
        o.put("isPhoneSynced", c.isPhoneSynced)
        o.put("isMissed", c.direction == CallDirection.Missed)
        o.put("sourceDeviceAddress", c.sourceDeviceAddress)
        return o
    }

    fun contact(c: ContactEntry): JSONObject {
        val o = JSONObject()
        o.put("id", "${c.sourceDeviceAddress}|${c.displayName}|${c.primaryPhone}")
        o.put("displayName", c.displayName)
        o.put("phoneNumbers", JSONArray(c.phoneNumbers))
        o.put("primaryPhone", c.primaryPhone)
        o.put("sourceDeviceAddress", c.sourceDeviceAddress)
        o.put("sourceFileName", c.sourceFileName)
        o.put("importedAt", isoTime(c.importedAt))
        return o
    }

    fun result(value: String): String = JSONObject().put("result", value).toString()

    fun error(message: String): String = JSONObject().put("error", message).toString()

    private fun sendStatusLabel(status: String): String = when (status) {
        "sending" -> "Sending"
        "sent" -> "Sent"
        "failed" -> "Failed"
        "confirming" -> "Confirming"
        else -> ""
    }

    private fun sendStatusIcon(status: String): String = when (status) {
        "sending" -> "schedule"
        "sent" -> "done"
        "failed" -> "error"
        "confirming" -> "schedule"
        else -> ""
    }

    fun formatPhoneDisplay(number: String): String {
        val d = number.filter { it.isDigit() }
        return if (d.length == 10) "(${d.substring(0, 3)}) ${d.substring(3, 6)}-${d.substring(6)}" else number
    }

    private fun timeDisplay(epochMs: Long): String =
        synchronized(iso) { SimpleDateFormat("MMM d, h:mm a", Locale.US).format(Date(epochMs)) }

    private fun durationDisplay(seconds: Int): String {
        if (seconds <= 0) return ""
        val m = seconds / 60
        val s = seconds % 60
        return if (m > 0) "${m}m ${s}s" else "${s}s"
    }
}
