package com.shamash.phonehost

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/** Restart the host after a reboot so the tablet is a zero-touch appliance. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // Without Bluetooth permission a connectedDevice foreground service may
        // not start (Android 12+) — skip silently; MainActivity re-asks on open.
        if (Build.VERSION.SDK_INT >= 31 &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) return
        val service = Intent(context, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service)
        else context.startService(service)
    }
}
