import SwiftUI

struct ContentView: View {
    @ObservedObject var model: BridgeModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    statusPanel
                    profilePanel
                    devicePanel
                    eventPanel
                }
                .padding(24)
            }
            .navigationTitle("Phone Bridge Probe")
            .toolbar {
                Button(model.probe.isScanning ? "Stop" : "Scan") {
                    if model.probe.isScanning {
                        model.probe.stopScan()
                    } else {
                        model.probe.startScan()
                    }
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Android phone to Shamash")
                .font(.title.weight(.semibold))
            Text("This iPad app probes whether iPadOS exposes the source phone's MAP, PBAP, and HFP Bluetooth services, then serves Shamash on localhost if the probe succeeds.")
                .foregroundStyle(.secondary)
            Text("http://127.0.0.1:8765")
                .font(.system(.title3, design: .monospaced))
                .padding(.top, 4)
        }
    }

    private var statusPanel: some View {
        panel("Local API") {
            row("Server", model.isRunning ? "Running" : "Stopped", model.isRunning ? .green : .red)
            row("Bluetooth", model.probe.bluetoothState, model.probe.bluetoothState == "poweredOn" ? .green : .orange)
            row("Mode", model.probe.isScanning ? "Scanning" : "Idle", model.probe.isScanning ? .blue : .secondary)
            row(
                "LAN host",
                model.lanHost.activeHost ?? "searching…",
                model.lanHost.activeHost != nil ? .green : .orange
            )
            if model.lanHost.activeHost != nil {
                Text("Proxying phone data from the host that holds the phone's Bluetooth link — no cloud relay.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var profilePanel: some View {
        panel("Target Profiles") {
            ForEach(model.probe.profileStatuses, id: \.key) { profile in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(profile.name)
                            .font(.headline)
                        Spacer()
                        Text(profile.uuid)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    Text(profile.purpose)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(profile.detail)
                        .font(.caption)
                        .foregroundStyle(profile.discovered ? .green : .orange)
                }
                .padding(.vertical, 6)
                Divider()
            }
        }
    }

    private var devicePanel: some View {
        panel("Nearby Devices") {
            if model.probe.devices.isEmpty {
                Text("No devices discovered yet. Start scan, make the Android phone discoverable if possible, and keep both devices close.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.probe.devices) { device in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(device.name)
                                    .font(.headline)
                                Text(device.id.uuidString)
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Probe") {
                                model.probe.probeDevice(id: device.id)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                        Text("RSSI \(device.rssi)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 8)
                    Divider()
                }
            }
        }
    }

    private var eventPanel: some View {
        panel("Event Log") {
            if model.probe.events.isEmpty {
                Text("No probe events yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.probe.events) { event in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(event.message)
                            .font(.subheadline)
                        Text(event.date.formatted(date: .omitted, time: .standard))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func panel<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            content()
        }
        .padding(16)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func row(_ label: String, _ value: String, _ color: Color) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .foregroundStyle(color)
                .fontWeight(.semibold)
        }
        .font(.subheadline)
    }
}

final class BridgeModel: ObservableObject {
    @Published var isRunning = false
    let probe = BluetoothProbeService()
    let lanHost = LanHostClient()
    private var server: LocalApiServer?

    func start() {
        probe.activate()
        lanHost.start()
        if server != nil { return }
        let controller = BridgeController(probe: probe, lanHost: lanHost)
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
