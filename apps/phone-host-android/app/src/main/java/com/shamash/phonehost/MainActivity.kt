package com.shamash.phonehost

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Setup & status screen, written for a non-technical owner:
 * one status card in plain language, one obvious action, the phone picker
 * by name only, and every technical detail (addresses, URLs, protocol log)
 * folded away behind "Advanced". The day-to-day UI is the Shamash web app;
 * this screen exists for first-run setup and "is it working?" checks.
 */
@SuppressLint("SetTextI18n", "MissingPermission")
class MainActivity : Activity() {

    private lateinit var statusDot: TextView
    private lateinit var statusTitle: TextView
    private lateinit var statusDetail: TextView
    private lateinit var actionButton: Button
    private lateinit var disconnectButton: Button
    private lateinit var deviceList: LinearLayout
    private lateinit var advancedToggle: TextView
    private lateinit var advancedBox: LinearLayout
    private lateinit var advancedInfo: TextView
    private lateinit var logView: TextView

    private val handler = Handler(Looper.getMainLooper())
    private val refreshLoop = object : Runnable {
        override fun run() {
            refresh()
            handler.postDelayed(this, 2000)
        }
    }

    private val green = 0xFF1E8E3E.toInt()
    private val orange = 0xFFE8710A.toInt()
    private val red = 0xFFD93025.toInt()
    private val gray = 0xFF9AA0A6.toInt()

    private fun dp(v: Int): Int = (resources.displayMetrics.density * v).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }

        root.addView(TextView(this).apply {
            text = "Shamash Phone Host"
            textSize = 24f
            setTypeface(typeface, Typeface.BOLD)
        })
        root.addView(TextView(this).apply {
            text = "Brings your phone's calls and texts to this tablet and your other devices."
            textSize = 14f
            alpha = 0.7f
            setPadding(0, dp(4), 0, dp(16))
        })

        // ── Status card ───────────────────────────────────────────────────
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0x14808080)
            }
        }
        val statusRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        statusDot = TextView(this).apply { text = "●"; textSize = 18f; setPadding(0, 0, dp(10), 0) }
        statusTitle = TextView(this).apply { textSize = 18f; setTypeface(typeface, Typeface.BOLD) }
        statusRow.addView(statusDot)
        statusRow.addView(statusTitle)
        card.addView(statusRow)
        statusDetail = TextView(this).apply { textSize = 14f; setPadding(0, dp(8), 0, 0) }
        card.addView(statusDetail)
        root.addView(card)

        // ── Actions ───────────────────────────────────────────────────────
        actionButton = Button(this).apply {
            isAllCaps = false
            textSize = 16f
        }
        root.addView(actionButton, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(16) })

        disconnectButton = Button(this).apply {
            isAllCaps = false
            textSize = 14f
            text = "Disconnect (use another device instead)"
            setOnClickListener {
                val service = HostService.instance ?: return@setOnClickListener
                android.app.AlertDialog.Builder(this@MainActivity)
                    .setTitle("Hand your phone to the PC?")
                    .setMessage("This tablet will disconnect from your phone and the PC takes over as the phone host. The web app's Tablet | PC switch follows automatically.")
                    .setPositiveButton("Hand off") { _, _ -> service.handoffToOtherHost(); refresh() }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
        root.addView(disconnectButton)

        // ── Phone picker ──────────────────────────────────────────────────
        root.addView(sectionHeader("Your phone"))
        deviceList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(deviceList)
        root.addView(TextView(this).apply {
            text = "Don't see your phone? Pair it first in this tablet's Settings → Bluetooth, then come back here."
            textSize = 13f
            alpha = 0.7f
            setPadding(0, dp(8), 0, 0)
        })

        // ── Advanced (collapsed by default) ───────────────────────────────
        advancedToggle = TextView(this).apply {
            text = "Advanced ▸"
            textSize = 14f
            alpha = 0.7f
            setPadding(0, dp(24), 0, dp(8))
            setOnClickListener {
                val show = advancedBox.visibility != LinearLayout.VISIBLE
                advancedBox.visibility = if (show) LinearLayout.VISIBLE else LinearLayout.GONE
                text = if (show) "Advanced ▾" else "Advanced ▸"
            }
        }
        root.addView(advancedToggle)
        advancedBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = LinearLayout.GONE
        }
        advancedInfo = TextView(this).apply { textSize = 12f; alpha = 0.7f }
        advancedBox.addView(advancedInfo)
        // Pairing recovery: if the owner switches Google accounts, other devices
        // get "paired to a different account" until this is tapped. Physical
        // access to the tablet is the permission model.
        advancedBox.addView(Button(this).apply {
            isAllCaps = false
            textSize = 13f
            text = "Reset app pairing (allow a different Google account)"
            setOnClickListener {
                HostService.instance?.hostAuth?.resetPairing()
                refresh()
            }
        })
        logView = TextView(this).apply {
            textSize = 11f
            typeface = Typeface.MONOSPACE
            setPadding(0, dp(8), 0, 0)
        }
        advancedBox.addView(logView)
        root.addView(advancedBox)

        setContentView(ScrollView(this).apply { addView(root) })
        requestNeededPermissions()
    }

    /** Manual Connect: if the PC is the live preferred host, connecting is a
     *  TAKEOVER — confirm first, then claim `preferred=tablet` (the PC releases on
     *  its own and every browser's Tablet|PC switch shifts). Plain retry otherwise.
     *  Only these user-facing buttons prompt; the watchdog/startup never do. */
    private fun confirmTakeoverThenConnect(service: HostService) {
        if (!service.otherHostHoldsPhone()) { service.connectToDefault(); refresh(); return }
        android.app.AlertDialog.Builder(this)
            .setTitle("Take over on this tablet?")
            .setMessage("The PC currently hosts your phone. It will disconnect and this tablet takes over. The web app's Tablet | PC switch follows automatically.")
            .setPositiveButton("Take over") { _, _ -> service.requestTakeover(); refresh() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun sectionHeader(title: String) = TextView(this).apply {
        text = title
        textSize = 16f
        setTypeface(typeface, Typeface.BOLD)
        setPadding(0, dp(24), 0, dp(8))
    }

    override fun onResume() {
        super.onResume()
        handler.post(refreshLoop)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refreshLoop)
    }

    // ── Permissions / service startup ─────────────────────────────────────
    private fun hasBtPermission(): Boolean =
        Build.VERSION.SDK_INT < 31 ||
            checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun requestNeededPermissions() {
        val needed = mutableListOf<String>()
        if (!hasBtPermission()) needed.add(Manifest.permission.BLUETOOTH_CONNECT)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) needed.add(Manifest.permission.POST_NOTIFICATIONS)

        if (needed.isEmpty()) startHost()
        else requestPermissions(needed.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // Only start the service once Bluetooth permission exists — starting a
        // connected-device foreground service without it crashes on Android 12+.
        if (hasBtPermission()) startHost()
        refresh()
    }

    private fun startHost() {
        if (!hasBtPermission()) return
        val intent = Intent(this, HostService::class.java)
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent) else startService(intent)
    }

    // ── Screen refresh ────────────────────────────────────────────────────
    private fun refresh() {
        val service = HostService.instance

        when {
            !hasBtPermission() -> setStatus(
                red, "Bluetooth permission needed",
                "This app connects to your phone over Bluetooth. Tap the button below and choose Allow.",
                "Allow Bluetooth access",
            ) { requestNeededPermissions() }

            service == null -> {
                setStatus(gray, "Starting…", "One moment.", null, null)
                startHost()
            }

            service.isPaused() -> setStatus(
                gray, "Paused",
                "Another device is handling your phone right now. Tap Connect to take over on this tablet.",
                "Connect",
            ) { confirmTakeoverThenConnect(service) }

            service.defaultDeviceAddress.isBlank() -> setStatus(
                orange, "Choose your phone",
                "Tap your phone's name in the list below to finish setup.",
                null, null,
            )

            service.isBusyConnecting() -> setStatus(
                orange, "Connecting…",
                "Linking to ${service.deviceName(service.defaultDeviceAddress) ?: "your phone"}. This can take a few seconds.",
                null, null,
            )

            service.isFullyConnected() -> setStatus(
                green, "Connected to ${service.deviceName(service.defaultDeviceAddress) ?: "your phone"}",
                "Calls and texts now show up on this tablet and your other Shamash devices. You can leave this app — it keeps working in the background.",
                null, null,
            )

            else -> setStatus(
                red, "Not connected",
                "Trying to reconnect automatically. Keep your phone nearby with Bluetooth turned on, or tap Connect to retry now.",
                "Connect",
            ) { confirmTakeoverThenConnect(service) }
        }

        disconnectButton.visibility =
            if (service?.isFullyConnected() == true) Button.VISIBLE else Button.GONE

        renderDeviceList(service)

        if (advancedBox.visibility == LinearLayout.VISIBLE) {
            advancedInfo.text = buildString {
                append("Build ${HostService.BUILD_STAMP}\n")
                append("Local API: http://127.0.0.1:8765\n")
                service?.lanUrl()?.let { append("Network API: $it\n") }
                append(
                    if (service?.hostAuth?.isEnforced() == true)
                        "Security: paired to your Google account — only your devices can connect\n"
                    else
                        "Security: open until first pairing (pair by opening Shamash signed in)\n"
                )
                if (service?.defaultDeviceAddress?.isNotBlank() == true) {
                    append("Phone Bluetooth address: ${service.defaultDeviceAddress}")
                }
            }
            logView.text = HostLog.tail(40).joinToString("\n")
        }
    }

    private fun setStatus(color: Int, title: String, detail: String, action: String?, onAction: (() -> Unit)?) {
        statusDot.setTextColor(color)
        statusTitle.text = title
        statusDetail.text = detail
        if (action != null && onAction != null) {
            actionButton.visibility = Button.VISIBLE
            actionButton.text = action
            actionButton.setOnClickListener { onAction(); refresh() }
        } else {
            actionButton.visibility = Button.GONE
        }
    }

    private fun renderDeviceList(service: HostService?) {
        deviceList.removeAllViews()
        if (!hasBtPermission()) return
        try {
            val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            val bonded = adapter?.bondedDevices ?: emptySet()
            if (bonded.isEmpty()) {
                deviceList.addView(TextView(this).apply {
                    text = "No paired devices yet."
                    textSize = 14f
                    alpha = 0.7f
                })
                deviceList.addView(Button(this).apply {
                    isAllCaps = false
                    text = "Open Bluetooth settings"
                    setOnClickListener {
                        runCatching { startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
                    }
                })
                return
            }
            // Every bonded device is listed (Android has no public API to filter
            // "in range now" from "paired at some point"), but the one actually
            // live right now should lead instead of being buried alphabetically —
            // that's what made the list read as "fake" (paired-forever devices
            // with no sense of which one is real).
            val liveAddress = service?.defaultDeviceAddress
                ?.takeIf { service.isFullyConnected() }
            val ordered = bonded.sortedWith(
                compareByDescending<BluetoothDevice> { it.address == liveAddress }
                    .thenBy { it.name ?: "" }
            )
            for (device in ordered) {
                val isSelected = device.address == service?.defaultDeviceAddress
                val isLive = device.address == liveAddress
                deviceList.addView(Button(this).apply {
                    isAllCaps = false
                    textSize = 15f
                    text = (device.name ?: "Unnamed device") + when {
                        isLive -> "   ✓ Connected now"
                        isSelected -> "   ✓"
                        else -> ""
                    }
                    setOnClickListener {
                        HostService.instance?.let {
                            it.defaultDeviceAddress = device.address
                            it.connectTo(device.address)
                        }
                        refresh()
                    }
                })
            }
        } catch (_: SecurityException) {
            // Permission was revoked mid-session; the status card already explains.
        }
    }
}
