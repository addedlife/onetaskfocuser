package com.shamash.phonehost

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Minimal control panel: permission bootstrap, paired-device picker,
 * live status + log tail. The real UI is the Shamash web app pointed at
 * http://127.0.0.1:8765 (or this tablet's LAN address from another device).
 */
@SuppressLint("SetTextI18n", "MissingPermission")
class MainActivity : Activity() {

    private lateinit var statusView: TextView
    private lateinit var logView: TextView
    private lateinit var deviceList: LinearLayout
    private val handler = Handler(Looper.getMainLooper())

    private val refreshLoop = object : Runnable {
        override fun run() {
            refresh()
            handler.postDelayed(this, 3000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val pad = (resources.displayMetrics.density * 16).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        root.addView(TextView(this).apply {
            text = "Shamash Phone Host (${HostService.BUILD_STAMP})"
            textSize = 20f
        })

        statusView = TextView(this).apply { textSize = 14f; setPadding(0, pad / 2, 0, pad / 2) }
        root.addView(statusView)

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(Button(this).apply {
            text = "Connect"
            setOnClickListener { HostService.instance?.connectToDefault() }
        })
        buttons.addView(Button(this).apply {
            text = "Release link"
            setOnClickListener { HostService.instance?.handoffRelease() }
        })
        root.addView(buttons)

        root.addView(TextView(this).apply {
            text = "Paired devices (tap to set as phone + connect):"
            setPadding(0, pad / 2, 0, 0)
        })
        deviceList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(deviceList)

        logView = TextView(this).apply {
            textSize = 11f
            typeface = android.graphics.Typeface.MONOSPACE
        }
        root.addView(ScrollView(this).apply {
            addView(logView)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0,
            ).apply { weight = 1f }
        })

        setContentView(root)
        requestNeededPermissions()
    }

    override fun onResume() {
        super.onResume()
        handler.post(refreshLoop)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refreshLoop)
    }

    private fun requestNeededPermissions() {
        val needed = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31 &&
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
        ) needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) needed.add(Manifest.permission.POST_NOTIFICATIONS)

        if (needed.isEmpty()) startHost()
        else requestPermissions(needed.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        startHost()
    }

    private fun startHost() {
        val intent = Intent(this, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
    }

    private fun refresh() {
        val service = HostService.instance
        statusView.text = if (service == null) {
            "Host service starting…"
        } else {
            val connected = service.isFullyConnected()
            "Phone link: ${if (connected) "CONNECTED" else "not connected"}\n" +
                "Default phone: ${service.defaultDeviceAddress.ifBlank { "none — pick below" }}\n" +
                "Web surfaces: http://127.0.0.1:8765 (this device) · advertised on LAN via mDNS"
        }

        deviceList.removeAllViews()
        try {
            val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            for (device in adapter?.bondedDevices ?: emptySet()) {
                deviceList.addView(Button(this).apply {
                    text = "${device.name ?: device.address}  (${device.address})" +
                        if (device.address == HostService.instance?.defaultDeviceAddress) "  ★" else ""
                    gravity = Gravity.START
                    setOnClickListener {
                        HostService.instance?.let {
                            it.defaultDeviceAddress = device.address
                            it.connectTo(device.address)
                        }
                    }
                })
            }
        } catch (_: SecurityException) {
            deviceList.addView(TextView(this).apply { text = "Bluetooth permission not granted yet." })
        }

        logView.text = HostLog.tail(60).joinToString("\n")
    }
}
