import SwiftUI

struct ContentView: View {
    @StateObject private var vm = AppViewModel()

    var body: some View {
        NavigationView {
            List {
                serverSection
                connectSection
                contactsSection
                capabilitiesSection
                if !vm.logEntries.isEmpty { logSection }
            }
            .navigationTitle("DeskPhone iOS")
            .navigationBarTitleDisplayMode(.large)
        }
        .navigationViewStyle(.stack)
        .onAppear  { vm.onAppear() }
        .onDisappear { vm.onDisappear() }
    }

    // MARK: - Sections

    private var serverSection: some View {
        Section("Server") {
            HStack(spacing: 12) {
                Image(systemName: vm.isServerRunning
                      ? "checkmark.circle.fill"
                      : "xmark.circle.fill")
                    .foregroundColor(vm.isServerRunning ? .green : .red)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.isServerRunning ? "Running" : "Stopped")
                        .font(.headline)
                    Text(vm.startupMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)

            if vm.isServerRunning {
                LabeledContent("Host URL") {
                    Text("http://127.0.0.1:8765")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var connectSection: some View {
        Section("Connect web app") {
            VStack(alignment: .leading, spacing: 6) {
                Text("Open the DeskPhone phone screen in Safari on this iPad. The host URL is already set to 127.0.0.1:8765 by default so no extra configuration is needed.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Keep this app visible (use Split View or Slide Over) so the HTTP server stays active.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }
    }

    private var contactsSection: some View {
        Section("Contacts") {
            HStack(spacing: 12) {
                Image(systemName: vm.contactsStatus == .authorized
                      ? "person.crop.circle.fill.badge.checkmark"
                      : "person.crop.circle.badge.xmark")
                    .foregroundColor(vm.contactsStatus == .authorized ? .green : .orange)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.contactsStatus.label)
                        .font(.subheadline)
                    if vm.contactsStatus == .authorized {
                        Text("\(vm.contactCount) contacts with phone numbers")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 4)

            if vm.contactsStatus == .authorized {
                Button("Refresh contacts") { vm.refreshContactCount() }
            }
        }
    }

    private var capabilitiesSection: some View {
        Section("Capabilities") {
            capRow("Contacts",     true,  "Read from iOS Contacts")
            capRow("Dial",         true,  "Taps open the Phone app")
            capRow("Send SMS",     true,  "Opens Messages to compose")
            capRow("SMS history",  false, "iOS sandbox — not accessible")
            capRow("Call history", false, "iOS sandbox — not accessible")
            capRow("Answer call",  false, "iOS cellular — not interceptable")
            capRow("Hang up",      false, "iOS cellular — not interceptable")
            capRow("Mute",         false, "iOS cellular — not interceptable")
        }
    }

    private var logSection: some View {
        Section("Recent activity") {
            ForEach(vm.logEntries.prefix(20), id: \.self) { line in
                Text(line)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func capRow(_ name: String, _ supported: Bool, _ note: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: supported ? "checkmark.circle.fill" : "minus.circle.fill")
                .foregroundColor(supported ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.subheadline)
                Text(note).font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    ContentView()
}
