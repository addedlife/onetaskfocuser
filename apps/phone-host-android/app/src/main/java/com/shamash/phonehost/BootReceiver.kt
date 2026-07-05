package com.shamash.phonehost

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/** Restart the host after a reboot so the tablet is a zero-touch appliance. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val service = Intent(context, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service)
        else context.startService(service)
    }
}
