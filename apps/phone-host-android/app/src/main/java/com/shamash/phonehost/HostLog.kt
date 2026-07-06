package com.shamash.phonehost

import android.util.Log
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * In-memory ring-buffer log served by GET /log, mirrored to logcat.
 * The Windows host writes deskphone.log to disk; on Android logcat plus this
 * buffer is enough for the debug surfaces.
 */
object HostLog {
    private const val TAG = "ShamashPhoneHost"
    private const val LIMIT = 2000
    private val lines = ArrayDeque<String>()
    private val stamp = SimpleDateFormat("MM/dd HH:mm:ss", Locale.US)

    @Volatile
    var listener: ((String) -> Unit)? = null

    @Synchronized
    fun add(line: String) {
        val stamped = "${stamp.format(Date())} $line"
        lines.addLast(stamped)
        while (lines.size > LIMIT) lines.removeFirst()
        Log.i(TAG, line)
        listener?.invoke(stamped)
    }

    @Synchronized
    fun tail(n: Int): List<String> = lines.toList().takeLast(n.coerceIn(1, LIMIT))
}
