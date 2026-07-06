package com.shamash.phonehost.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import com.shamash.phonehost.CallDirection
import com.shamash.phonehost.CallRecord
import com.shamash.phonehost.ContactEntry
import com.shamash.phonehost.HostLog
import com.shamash.phonehost.PhoneUtil
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

/**
 * PBAP (Phone Book Access Profile) client — port of the Windows PbapService,
 * extended to also pull the full phonebook (pb.vcf) so contacts sync straight
 * off the phone instead of manual .vcf file drops.
 *
 * Objects: pb.vcf (contacts), ich.vcf (incoming), och.vcf (outgoing),
 * mch.vcf (missed). Sessions are short-lived: connect, download, disconnect.
 */
@SuppressLint("MissingPermission")
class PbapClient(private val log: (String) -> Unit = { HostLog.add(it) }) {

    companion object {
        val PSE_UUID: UUID = UUID.fromString("0000112F-0000-1000-8000-00805F9B34FB")
        private const val OBEX_SUCCESS = 0xA0
    }

    class ImportResult(
        val succeeded: Boolean,
        val calls: List<CallRecord> = emptyList(),
        val contacts: List<ContactEntry> = emptyList(),
        val summary: String = "",
    )

    fun importAll(device: BluetoothDevice, includeContacts: Boolean = true): ImportResult {
        var socket: BluetoothSocket? = null
        var obex: ObexClient? = null
        try {
            // Targeted OBEX first, bare OBEX fallback — same ladder as Windows.
            for (target in arrayOf(ObexClient.PBAP_TARGET_UUID, null)) {
                try {
                    socket?.close()
                    socket = device.createRfcommSocketToServiceRecord(PSE_UUID)
                    socket.connect()
                    val o = ObexClient(socket.inputStream, socket.outputStream, target)
                    if (o.connect()) {
                        obex = o
                        log("[PBAP] OBEX CONNECT OK (${if (target != null) "targeted" else "bare"}) ConnID=${o.connectionId}")
                        break
                    }
                    log("[PBAP] OBEX CONNECT rejected (${if (target != null) "targeted" else "bare"})")
                } catch (ex: Exception) {
                    log("[PBAP] connect attempt failed: ${ex.message}")
                }
            }
            val o = obex ?: return ImportResult(false, summary = "PBAP session could not be opened. Enable contact/call-history sharing for this device on the phone, then retry.")

            val incoming = downloadPhonebook(o, "ich.vcf")
            val outgoing = downloadPhonebook(o, "och.vcf")
            val missed = downloadPhonebook(o, "mch.vcf")

            val calls = mutableListOf<CallRecord>()
            calls += parseCallLog(incoming, CallDirection.Incoming, "ich.vcf", device.address)
            calls += parseCallLog(outgoing, CallDirection.Outgoing, "och.vcf", device.address)
            calls += parseCallLog(missed, CallDirection.Missed, "mch.vcf", device.address)
            calls.sortByDescending { it.time }

            val contacts = if (includeContacts) {
                parseContacts(downloadPhonebook(o, "pb.vcf"), device.address)
            } else emptyList()

            log("[PBAP] Imported ${calls.size} call log entries, ${contacts.size} contacts")
            return ImportResult(
                true, calls, contacts,
                "PBAP imported ${calls.size} call log entries and ${contacts.size} contacts.",
            )
        } catch (ex: Exception) {
            log("[PBAP] Import failed: ${ex.message}")
            return ImportResult(false, summary = "PBAP import failed: ${ex.message}")
        } finally {
            try { obex?.disconnect() } catch (_: Exception) {}
            try { socket?.close() } catch (_: Exception) {}
        }
    }

    private fun downloadPhonebook(obex: ObexClient, objectName: String): String {
        obex.setPath("")
        val telecomReady = obex.setPath("telecom")
        var result = if (telecomReady) {
            var r = obex.getResult("x-bt/phonebook", objectName)
            if (r.responseCode == OBEX_SUCCESS && r.body.isEmpty()) {
                r = obex.getResult("x-bt/phonebook", "telecom/$objectName")
            }
            r
        } else {
            obex.getResult("x-bt/phonebook", "telecom/$objectName")
        }

        if (result.responseCode != OBEX_SUCCESS) {
            log("[PBAP] $objectName download rejected (OBEX 0x%02X)".format(result.responseCode))
            return ""
        }
        log("[PBAP] Downloaded $objectName (${result.body.size} bytes)")
        return String(result.body, Charsets.UTF_8)
    }

    // ── vCard parsing ─────────────────────────────────────────────────────
    private fun parseCallLog(
        text: String,
        direction: CallDirection,
        sourceObject: String,
        deviceAddress: String,
    ): List<CallRecord> {
        val entries = mutableListOf<CallRecord>()
        for (card in splitVcards(text)) {
            var number = ""
            var name = ""
            var structuredName = ""
            var rawTimestamp = ""
            var timestamp = System.currentTimeMillis()

            for (line in card) {
                val idx = line.indexOf(':')
                if (idx <= 0) continue
                var property = line.substring(0, idx).split(';')[0]
                if (property.contains('.')) property = property.substringAfterLast('.')
                val value = unescape(line.substring(idx + 1)).trim()

                when {
                    property.equals("FN", true) -> name = value
                    property.equals("N", true) -> structuredName =
                        value.split(';').filter { it.isNotBlank() }.joinToString(" ") { it.trim() }
                    property.equals("TEL", true) -> number = PhoneUtil.normalize(value)
                    property.equals("X-IRMC-CALL-DATETIME", true) -> {
                        rawTimestamp = value
                        parseCallDateTime(value)?.let { timestamp = it }
                    }
                }
            }

            if (number.isBlank() && name.isBlank() && structuredName.isBlank()) continue
            entries.add(
                CallRecord(
                    number = number,
                    name = name.ifBlank { structuredName.ifBlank { null } },
                    direction = direction,
                    time = timestamp,
                    isPhoneSynced = true,
                    sourceDeviceAddress = deviceAddress,
                    rawTimestamp = rawTimestamp,
                    sourceObject = sourceObject,
                ),
            )
        }
        return entries
    }

    private fun parseContacts(text: String, deviceAddress: String): List<ContactEntry> {
        val contacts = mutableListOf<ContactEntry>()
        for (card in splitVcards(text)) {
            var name = ""
            var structuredName = ""
            val phones = mutableListOf<String>()
            for (line in card) {
                val idx = line.indexOf(':')
                if (idx <= 0) continue
                var property = line.substring(0, idx).split(';')[0]
                if (property.contains('.')) property = property.substringAfterLast('.')
                val value = unescape(line.substring(idx + 1)).trim()
                when {
                    property.equals("FN", true) -> name = value
                    property.equals("N", true) -> structuredName =
                        value.split(';').filter { it.isNotBlank() }.joinToString(" ") { it.trim() }
                    property.equals("TEL", true) -> {
                        val normalized = PhoneUtil.normalize(value)
                        if (normalized.isNotBlank() && normalized !in phones) phones.add(normalized)
                    }
                }
            }
            val displayName = name.ifBlank { structuredName }
            if (displayName.isBlank() || phones.isEmpty()) continue
            contacts.add(
                ContactEntry(
                    displayName = displayName,
                    phoneNumbers = phones,
                    sourceDeviceAddress = deviceAddress,
                    sourceFileName = "pb.vcf",
                ),
            )
        }
        return contacts
    }

    private fun splitVcards(text: String): List<List<String>> {
        if (text.isBlank()) return emptyList()
        val lines = unfoldLines(text)
        val cards = mutableListOf<List<String>>()
        var current: MutableList<String>? = null
        for (line in lines) {
            when {
                line.equals("BEGIN:VCARD", true) -> current = mutableListOf()
                line.equals("END:VCARD", true) -> { current?.let { cards.add(it) }; current = null }
                else -> current?.add(line)
            }
        }
        return cards
    }

    private fun unfoldLines(text: String): List<String> {
        val source = text.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        val lines = mutableListOf<String>()
        for (line in source) {
            if ((line.startsWith(" ") || line.startsWith("\t")) && lines.isNotEmpty()) {
                lines[lines.size - 1] += line.trimStart()
            } else {
                lines.add(line)
            }
        }
        return lines
    }

    private fun unescape(value: String): String = value
        .replace("\\n", "\n", ignoreCase = true)
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")

    private fun parseCallDateTime(value: String): Long? {
        val formats = arrayOf(
            "yyyyMMdd'T'HHmmss",
            "yyyyMMdd'T'HHmmss'Z'",
            "yyyyMMdd'T'HHmmssZ",
        )
        for (f in formats) {
            try {
                return SimpleDateFormat(f, Locale.US).parse(value.trim())?.time
            } catch (_: Exception) {}
        }
        return null
    }
}
