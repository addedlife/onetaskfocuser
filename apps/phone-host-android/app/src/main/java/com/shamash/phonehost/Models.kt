package com.shamash.phonehost

/**
 * Shared data models. Field names mirror the Windows DeskPhone host
 * (apps/phone-host-windows/Models) so the /status /messages /calls /contacts
 * JSON contract stays byte-compatible for the web surfaces.
 */

enum class CallStatus { Idle, IncomingRinging, Dialing, Active, Ending }

enum class CallDirection { Incoming, Outgoing, Missed }

data class CallInfo(
    var status: CallStatus = CallStatus.Idle,
    var direction: CallDirection = CallDirection.Incoming,
    var number: String = "",
    var displayName: String? = null,
    var startTime: Long = 0L,
)

class MessageAttachment(
    val contentType: String,
    val fileName: String,
    val data: ByteArray,
) {
    val isImage: Boolean get() = contentType.startsWith("image/", ignoreCase = true)
    val isContactCard: Boolean get() = contentType.contains("vcard", ignoreCase = true)
}

class SmsMessage(
    var handle: String = "",
    var localId: String? = null,
    var from: String = "",
    var body: String = "",
    var timestamp: Long = System.currentTimeMillis(),
    var isSent: Boolean = false,
    var isRead: Boolean = false,
    var isPinned: Boolean = false,
    var isMms: Boolean = false,
    var sendStatus: String = "",           // "", "sending", "sent", "failed"
    var sourceDeviceAddress: String = "",
) {
    val attachments = mutableListOf<MessageAttachment>()

    val hasImageAttachment: Boolean get() = attachments.any { it.isImage }

    /** Digits-only peer number, matching ContactStoreService.NormalizePhone on Windows. */
    val normalizedPhone: String get() = PhoneUtil.normalize(from)

    val previewBody: String
        get() {
            val text = body.trim()
            return when {
                text.isNotEmpty() -> if (text.length > 120) text.take(117) + "…" else text
                hasImageAttachment -> "[Photo]"
                attachments.isNotEmpty() -> "[Attachment]"
                else -> ""
            }
        }
}

class CallRecord(
    var number: String = "",
    var name: String? = null,
    var direction: CallDirection = CallDirection.Incoming,
    var time: Long = System.currentTimeMillis(),
    var durationSeconds: Int = 0,
    var isPhoneSynced: Boolean = false,   // true when imported from the phone via PBAP
    var sourceDeviceAddress: String = "",
    var rawTimestamp: String = "",
    var sourceObject: String = "",        // ich.vcf / och.vcf / mch.vcf / live-hfp
) {
    val directionLabel: String
        get() = when (direction) {
            CallDirection.Incoming -> "Incoming"
            CallDirection.Outgoing -> "Outgoing"
            CallDirection.Missed -> "Missed"
        }
}

class ContactEntry(
    var displayName: String = "",
    var phoneNumbers: MutableList<String> = mutableListOf(),
    var sourceDeviceAddress: String = "",
    var sourceFileName: String = "",
    var importedAt: Long = System.currentTimeMillis(),
) {
    val primaryPhone: String get() = phoneNumbers.firstOrNull() ?: ""
}

object PhoneUtil {
    /** Port of ContactStoreService.NormalizePhone (Windows host). */
    fun normalize(src: String?): String {
        if (src.isNullOrBlank()) return ""
        var value = src.trim()
        if (value.startsWith("Me >", ignoreCase = true)) {
            value = if (value.length > 5) value.substring(5).trim() else ""
        }
        if (value.startsWith("tel:", ignoreCase = true)) value = value.substring(4).trim()
        val metaIdx = value.indexOfFirst { it == ';' || it == '?' || it == ',' }
        if (metaIdx >= 0) value = value.substring(0, metaIdx).trim()
        var digits = value.filter { it.isDigit() }
        if (digits.length == 11 && digits.startsWith("1")) digits = digits.substring(1)
        return digits
    }
}
