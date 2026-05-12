import Foundation
import Contacts

/// Reads iOS Contacts and serialises them into the same JSON shape that the
/// Windows host returns from GET /contacts (ContactEntry model).
///
/// JSON shape per contact:
/// {
///   "DisplayName": "Jane Smith",
///   "PhoneNumbers": ["+1 555 0100", "+1 555 0101"],
///   "SourceDeviceAddress": "",
///   "SourceFileName": "iOS Contacts",
///   "ImportedAt": "2025-05-12T10:00:00Z"
/// }
final class ContactsService {
    static let shared = ContactsService()

    private let store = CNContactStore()

    private init() {}

    // MARK: - Authorization

    func requestAccess(completion: @escaping (Bool) -> Void) {
        store.requestAccess(for: .contacts) { granted, _ in
            DispatchQueue.main.async { completion(granted) }
        }
    }

    var authorizationStatus: CNAuthorizationStatus {
        CNContactStore.authorizationStatus(for: .contacts)
    }

    // MARK: - Fetch

    /// Returns a JSON array string. Called from the API service on the server queue.
    func fetchContactsJSON() -> String {
        let keysToFetch: [CNKeyDescriptor] = [
            CNContactGivenNameKey   as CNKeyDescriptor,
            CNContactFamilyNameKey  as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
        ]

        let request = CNContactFetchRequest(keysToFetch: keysToFetch)
        request.sortOrder = .userDefault

        var entries: [String] = []
        let importedAt = ISO8601DateFormatter().string(from: Date())

        do {
            try store.enumerateContacts(with: request) { contact, _ in
                let fullName = [contact.givenName, contact.familyName]
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespaces)

                guard !fullName.isEmpty else { return }

                let phones = contact.phoneNumbers.map { $0.value.stringValue }
                guard !phones.isEmpty else { return }

                let phonesJSON = phones
                    .map { "\"" + $0.jsonEscaped + "\"" }
                    .joined(separator: ",")

                entries.append("""
                {"DisplayName":"\(fullName.jsonEscaped)","PhoneNumbers":[\(phonesJSON)],"SourceDeviceAddress":"","SourceFileName":"iOS Contacts","ImportedAt":"\(importedAt)"}
                """)
            }
        } catch {
            return "[]"
        }

        return "[" + entries.joined(separator: ",") + "]"
    }

    /// Returns the number of contacts with at least one phone number.
    func contactCount() -> Int {
        let keysToFetch: [CNKeyDescriptor] = [
            CNContactPhoneNumbersKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keysToFetch)
        var count = 0
        try? store.enumerateContacts(with: request) { contact, _ in
            if !contact.phoneNumbers.isEmpty { count += 1 }
        }
        return count
    }
}

private extension String {
    var jsonEscaped: String {
        self
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
    }
}
