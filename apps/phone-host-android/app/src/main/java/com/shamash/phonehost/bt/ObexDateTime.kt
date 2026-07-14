package com.shamash.phonehost.bt

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Shared OBEX/vCard datetime parser for MAP and PBAP: "YYYYMMDDTHHMMSS", optionally
 * followed by a UTC offset ("+HHMM"/"-HHMM") or "Z".
 *
 * Feeding the whole string straight to SimpleDateFormat("yyyyMMdd'T'HHmmss") silently
 * drops any offset suffix — Java's parse() ignores unparsed trailing characters instead
 * of failing — and interprets the wall-clock digits in the device's own default zone.
 * When the phone reports a different zone (commonly UTC) that produced a fixed
 * multi-hour skew across every synced message and call (the long-standing "+4h"
 * ticket), which in turn defeated the web's fuzzy send-dedupe window and made sent
 * texts double up on this host. Parsing the offset explicitly fixes both.
 */
internal object ObexDateTime {
    private val BASE_FORMAT = SimpleDateFormat("yyyyMMdd'T'HHmmss", Locale.US)

    fun parse(raw: String?): Long? {
        val s = raw?.trim().takeUnless { it.isNullOrEmpty() } ?: return null
        val core = if (s.length >= 15) s.substring(0, 15) else s
        val parsed = try {
            synchronized(BASE_FORMAT) { BASE_FORMAT.parse(core) }
        } catch (_: Exception) {
            null
        } ?: return null

        val suffix = if (s.length > 15) s.substring(15).trim() else ""
        val offsetMillis: Long = when {
            suffix.isEmpty() -> return parsed.time
            suffix.equals("Z", ignoreCase = true) -> 0L
            suffix.length == 5 && (suffix[0] == '+' || suffix[0] == '-') -> {
                val h = suffix.substring(1, 3).toIntOrNull()
                val m = suffix.substring(3, 5).toIntOrNull()
                if (h == null || m == null) return parsed.time
                val sign = if (suffix[0] == '-') -1 else 1
                (sign * (h * 3_600_000L + m * 60_000L)).toLong()
            }
            else -> return parsed.time
        }

        // BASE_FORMAT parsed the digits as wall-clock time in the device's default
        // zone; re-derive the true instant using the offset actually reported.
        val deviceOffsetMillis = TimeZone.getDefault().getOffset(parsed.time)
        return parsed.time + (deviceOffsetMillis - offsetMillis)
    }
}
