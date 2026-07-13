import SwiftUI

/// Consumer-first status screen: one plain-language card that says whether
/// calls and texts are flowing, and everything technical (Bluetooth probe,
/// device scans, event log) folded into a collapsed Advanced section.
struct ContentView: View {
    @ObservedObject var model: BridgeModel
    // Nested ObservableObjects don't propagate through `model` — observe them
    // directly or the status card never refreshes when the LAN host appears.
    @ObservedObject private var probe: BluetoothProbeService
    @ObservedObject private var lanHost: LanHostClient

    init(model: BridgeModel) {
        _model = ObservedObject(wrappedValue: model)
        _probe = ObservedObject(wrappedValue: model.probe)
        _lanHost = ObservedObject(wrappedValue: model.lanHost)
    }

    private var isLinked: Bool { lanHost.activeHost != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    statusCard
                    advancedSection
                }
                .padding(24)
            }
            .navigationTitle("Phone Link")
        }
    }

    // ── Status card ─────────────────────────────────────────────────────
    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Circle()
                    .fill(isLinked ? Color.green : Color.orange)
                    .frame(width: 12, height: 12)
                Text(isLinked ? "Connected" : "Searching…")
                    .font(.title2.weight(.semibold))
            }
            Text(isLinked
                ? "Calls and texts from your phone are available on this iPad."
                : "Looking for your phone's connection. Make sure the device linked to your phone — your computer or tablet — is turned on and using the same Wi-Fi as this iPad.")
                .foregroundStyle(.secondary)
            if !model.isRunning {
                Label("The link service could not start. Close and reopen this app.", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.red)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // ── Advanced (collapsed diagnostics) ────────────────────────────────
    private var advancedSection: some View {
        DisclosureGroup("Advanced") {
            VStack(alignment: .leading, spacing: 20) {
                panel("Connection details") {
                    row("Local server", model.isRunning ? "Running" : "Stopped", model.isRunning ? .green : .red)
                    row("Phone host on network", lanHost.activeHost ?? "not found yet", isLinked ? .green : .orange)
                    if let error = lanHost.lastError {
                        Text(error).font(.caption).foregroundStyle(.secondary)
                    }
                    Text("http://127.0.0.1:8765")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }

                panel("Bluetooth probe") {
                    Text("Tests whether this iPad could ever talk to the phone over Bluetooth directly. Expected to fail on current iPadOS — the network link above is the working path.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    row("Bluetooth", probe.bluetoothState, probe.bluetoothState == "poweredOn" ? .green : .orange)
                    Button(probe.isScanning ? "Stop scan" : "Start scan") {
                        if probe.isScanning { probe.stopScan() } else { probe.startScan() }
                    }
                    .buttonStyle(.bordered)
                }

                profilePanel
                devicePanel
                eventPanel
            }
            .padding(.top, 12)
        }
        .padding(20)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var profilePanel: some View {
        panel("Target profiles") {
            ForEach(probe.profileStatuses, id: \.key) { profile in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(profile.name)
                            .font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(profile.uuid)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    Text(profile.detail)
                        .font(.caption)
                        .foregroundStyle(profile.discovered ? .green : .orange)
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var devicePanel: some View {
        panel("Nearby devices") {
            if probe.devices.isEmpty {
                Text("No devices discovered yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(probe.devices) { device in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(device.name).font(.subheadline)
                            Text("RSSI \(device.rssi)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Probe") { probe.probeDevice(id: device.id) }
                            .buttonStyle(.bordered)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private var eventPanel: some View {
        panel("Event log") {
            if probe.events.isEmpty {
                Text("No events yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(probe.events.prefix(40)) { event in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.message).font(.caption)
                        Text(event.date.formatted(date: .omitted, time: .standard))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func panel<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content()
        }
    }

    private func row(_ label: String, _ value: String, _ color: Color) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).foregroundStyle(color).fontWeight(.semibold)
        }
        .font(.subheadline)
    }
}

final class BridgeModel: ObservableObject {
    @Published var isRunning = false
    let probe = BluetoothProbeService()
    let lanHost = LanHostClient()
    private var relay: RelayPresenceService?
    private var server: LocalApiServer?

    func start() {
        probe.activate()
        lanHost.start()
        if relay == nil {
            // Cloud lane: presence beacon (hosts.ios) + state push while the
            // web toggle prefers the iPad — same Firestore relay as the other hosts.
            let r = RelayPresenceService(lanHost: lanHost)
            r.start()
            relay = r
        }
        if server != nil { return }
        let controller = BridgeController(probe: probe, lanHost: lanHost, relay: relay)
        let next = LocalApiServer(port: 8765, controller: controller, lanHost: lanHost)
        do {
            try next.start()
            server = next
            isRunning = true
        } catch {
            isRunning = false
        }
    }
}
