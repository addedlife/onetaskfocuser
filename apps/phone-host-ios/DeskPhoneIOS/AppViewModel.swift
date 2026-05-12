import Foundation
import SwiftUI
import Contacts

@MainActor
final class AppViewModel: ObservableObject {
    @Published var isServerRunning   = false
    @Published var startupMessage    = "Starting…"
    @Published var contactsStatus    = ContactsStatus.unknown
    @Published var contactCount      = 0
    @Published var logEntries: [String] = []

    private let api      = ControlAPIService.shared
    private let contacts = ContactsService.shared

    private var logTimer: Timer?

    enum ContactsStatus {
        case unknown, authorized, denied
        var label: String {
            switch self {
            case .unknown:    return "Checking…"
            case .authorized: return "Authorized"
            case .denied:     return "Denied — open Settings to allow access"
            }
        }
    }

    func onAppear() {
        wireCallbacks()
        requestContactsAccess()
        api.start()
        startLogTimer()
    }

    func onDisappear() {
        logTimer?.invalidate()
        logTimer = nil
    }

    // MARK: - Setup

    private func wireCallbacks() {
        api.onStatusChange = { [weak self] running, message in
            Task { @MainActor in
                self?.isServerRunning  = running
                self?.startupMessage   = message
            }
        }

        api.getContacts = { [weak self] in
            // Called on the server queue — ContactsService is thread-safe
            self?.contacts.fetchContactsJSON() ?? "[]"
        }

        api.refreshContacts = { [weak self] in
            // Already dispatched to main by ControlAPIService
            self?.refreshContactCount()
        }
    }

    private func requestContactsAccess() {
        let current = contacts.authorizationStatus
        switch current {
        case .authorized:
            contactsStatus = .authorized
            refreshContactCount()
        case .denied, .restricted:
            contactsStatus = .denied
        default:
            contacts.requestAccess { [weak self] granted in
                Task { @MainActor in
                    self?.contactsStatus = granted ? .authorized : .denied
                    if granted { self?.refreshContactCount() }
                }
            }
        }
    }

    func refreshContactCount() {
        Task.detached(priority: .userInitiated) { [weak self] in
            guard let self else { return }
            let count = self.contacts.contactCount()
            await MainActor.run { self.contactCount = count }
        }
    }

    // MARK: - Log

    private func startLogTimer() {
        logTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in
                self.logEntries = Array(self.api.logEntries.suffix(50).reversed())
            }
        }
    }
}
