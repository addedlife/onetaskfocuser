import Foundation
import Network
import UIKit

/// DeskPhone iOS host control API on http://localhost:8765/
/// Uses NWListener (Network.framework) — no special entitlements required.
///
/// Mirrors the Windows ControlApiService endpoint surface exactly.
/// Endpoints that require Bluetooth classic or cellular OS access
/// return {"result":"not supported on iOS"} rather than an error so
/// the web app stays happy and shows the iOS host as online.
///
/// Supported endpoints:
///   GET  /status          → host, connection, call state
///   GET  /contacts        → iOS Contacts as JSON (matches Windows ContactEntry shape)
///   GET  /messages        → always [] (iOS sandbox blocks SMS history)
///   GET  /calls           → always [] (iOS sandbox blocks call history)
///   GET  /log?n=N         → last N log lines
///   POST /connect         → no-op (no BT phone to pair)
///   POST /dial?n=NUMBER   → opens tel:// URL
///   POST /send?to=X&body=Y → opens sms:// URL (launches Messages)
///   POST /send-with-attachments → opens sms:// with body (attachments dropped)
///   POST /refresh         → re-reads contacts
///   POST /show            → no-op (app is already on screen)
///   POST /theme           → posts themeChanged notification
///   POST /handoff?target=X → no-op
///   POST /shutdown        → exits the process
///   POST <any other known endpoint> → {"result":"not applicable on iOS"}
final class ControlAPIService {
    static let shared = ControlAPIService()

    private let port: UInt16 = 8765
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "com.addedlife.deskphone.api", qos: .userInitiated)

    private let logLock = NSLock()
    private var _logEntries: [String] = []
    var logEntries: [String] {
        logLock.lock(); defer { logLock.unlock() }
        return _logEntries
    }

    // Wired up by AppViewModel
    var getContacts: (() -> String)?
    var refreshContacts: (() -> Void)?
    var onStatusChange: ((Bool, String) -> Void)?

    private init() {}

    // MARK: - Lifecycle

    func start() {
        stop()
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        } catch {
            notify(running: false, message: "FAILED — \(error.localizedDescription)")
            return
        }

        listener?.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.addLog("Server started on port \(self.port)")
                self.notify(running: true, message: "OK — listening on http://localhost:\(self.port)/")
            case .failed(let error):
                self.addLog("Server failed: \(error)")
                self.notify(running: false, message: "FAILED — \(error)")
            case .cancelled:
                self.notify(running: false, message: "Stopped")
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: queue)
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connection handling

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: queue)
        accumulate(connection: connection, buffer: Data())
    }

    private func accumulate(connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] chunk, _, isComplete, error in
            guard let self else { return }
            var buf = buffer
            if let chunk { buf.append(chunk) }
            let hasHeaderEnd = buf.range(of: Data("\r\n\r\n".utf8)) != nil
            if hasHeaderEnd || isComplete || error != nil {
                let raw = String(data: buf, encoding: .utf8) ?? ""
                let responseData = self.processRequest(raw)
                connection.send(content: responseData, completion: .contentProcessed { _ in
                    connection.cancel()
                })
            } else if buf.count < 16 * 1024 * 1024 {
                self.accumulate(connection: connection, buffer: buf)
            } else {
                connection.cancel()
            }
        }
    }

    // MARK: - HTTP parsing

    private func processRequest(_ raw: String) -> Data {
        let lines = raw.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return makeResponse(body: jsonError("bad request"), statusCode: 400)
        }
        let parts = requestLine.split(separator: " ", maxSplits: 2)
        guard parts.count >= 2 else {
            return makeResponse(body: jsonError("bad request"), statusCode: 400)
        }

        let method = String(parts[0]).uppercased()
        let rawPath = String(parts[1])

        if method == "OPTIONS" { return makeResponse(body: "", statusCode: 204) }

        let (path, qs) = splitPathAndQuery(rawPath)
        var body = ""
        if let headerEnd = raw.range(of: "\r\n\r\n") {
            body = String(raw[headerEnd.upperBound...])
        }

        let (responseBody, statusCode) = handleRequest(method: method, path: path, qs: qs, body: body)
        return makeResponse(body: responseBody, statusCode: statusCode)
    }

    private func splitPathAndQuery(_ rawPath: String) -> (String, String) {
        if let idx = rawPath.firstIndex(of: "?") {
            return (String(rawPath[..<idx]).lowercased(), String(rawPath[rawPath.index(after: idx)...]))
        }
        return (rawPath.lowercased(), "")
    }

    // MARK: - Routing

    private func handleRequest(method: String, path: String, qs: String, body: String) -> (String, Int) {
        addLog("\(method) \(path)")

        // GET / mixed endpoints
        switch path {
        case "", "/status":
            return (buildStatus(), 200)
        case "/contacts":
            return (getContacts?() ?? "[]", 200)
        case "/messages":
            return ("[]", 200)
        case "/calls":
            return ("[]", 200)
        case "/log":
            let n = parseInt(qs: qs, key: "n", default: 100)
            return (jsonSerializeStrings(Array(logEntries.suffix(n))), 200)
        default:
            break
        }

        guard method == "POST" else {
            return (jsonError("unknown: \(path)"), 404)
        }

        switch path {
        case "/connect":
            return (json("result", "connect triggered"), 200)

        case "/answer", "/hangup", "/toggle-mute":
            return (json("result", "not supported on iOS"), 200)

        case "/refresh":
            DispatchQueue.main.async { self.refreshContacts?() }
            return (json("result", "refresh triggered"), 200)

        case "/dial":
            let number = parseStr(qs: qs, key: "n")
            guard !number.isEmpty else { return (jsonError("missing ?n=NUMBER"), 400) }
            openURL("tel://\(number)")
            return (json("result", "dialing \(number)"), 200)

        case "/send":
            let to   = parseStr(qs: qs, key: "to")
            let text = parseStr(qs: qs, key: "body")
            guard !to.isEmpty, !text.isEmpty else { return (jsonError("missing ?to=X&body=Y"), 400) }
            openURL(makeSmsURL(to: to, body: text))
            return (json("result", "sent"), 200)

        case "/send-with-attachments":
            if let data = body.data(using: .utf8),
               let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let to = payload["to"] as? String {
                let text = (payload["body"] as? String) ?? ""
                openURL(makeSmsURL(to: to, body: text))
                return (json("result", "sent"), 200)
            }
            return (jsonError("invalid body"), 400)

        case "/show":
            return (json("result", "shown"), 200)

        case "/theme":
            let colors = parseThemeColors(qs)
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: .deskPhoneThemeChanged,
                    object: nil,
                    userInfo: colors as [AnyHashable: Any]
                )
            }
            return (json("result", "theme applied"), 200)

        case "/handoff":
            let target = parseStr(qs: qs, key: "target")
            guard !target.isEmpty else { return (jsonError("missing ?target=X"), 400) }
            return (json("result", "handoff triggered"), 200)

        case "/shutdown":
            addLog("Shutdown requested")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
            return (json("result", "shutdown triggered"), 200)

        default:
            if knownButUnsupportedEndpoints.contains(path) {
                return (json("result", "not applicable on iOS"), 200)
            }
            return (jsonError("unknown: \(path)"), 404)
        }
    }

    // These exist on Windows but have no iOS equivalent; return 200 so the
    // web app doesn't treat the host as offline.
    private let knownButUnsupportedEndpoints: Set<String> = [
        "/set-theme-sync", "/set-history-paused", "/set-dark-mode",
        "/reset-ui-scale", "/audio-refresh", "/import-starter-vcf",
        "/import-pending-contacts", "/skip-pending-contacts",
        "/export-messages-backup", "/open-bluetooth-settings",
        "/open-sound-settings", "/open-builds-folder", "/open-event-log",
        "/open-contact-sync-folder", "/open-live-log", "/clear-log",
        "/run-ui-auditor", "/test-reg", "/offer-update",
        "/stage", "/stage-pulse", "/stage-exit",
        "/mark-conversation-read", "/mark-conversation-unread",
        "/toggle-conversation-pin", "/toggle-conversation-mute",
        "/toggle-conversation-block", "/toggle-call-block",
        "/toggle-message-pin", "/delete-message", "/undo-message-delete",
        "/delete-call-entry", "/delete-all-call-history",
        "/undo-call-history-delete", "/accept-build-update",
        "/snooze-build-update", "/show-build-update-prompt",
        "/scan-devices", "/connect-saved-device",
        "/set-default-saved-device", "/forget-saved-device",
        "/connect-scanned-device", "/save-contact", "/delete-contact",
        "/refresh-theme-sync",
    ]

    // MARK: - Utilities

    private func openURL(_ urlString: String) {
        guard let url = URL(string: urlString) else { return }
        DispatchQueue.main.async { UIApplication.shared.open(url) }
    }

    private func makeSmsURL(to: String, body: String) -> String {
        let encoded = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? body
        return "sms:\(to)&body=\(encoded)"
    }

    private func buildStatus() -> String {
        "{\"host\":\"iOS\",\"connection\":\"idle\",\"callState\":\"Idle\",\"unreadMessages\":0,\"platform\":\"ios\",\"version\":\"1.0\"}"
    }

    private func makeResponse(body: String, statusCode: Int) -> Data {
        let bodyBytes = Data(body.utf8)
        let reason: String
        switch statusCode {
        case 204: reason = "No Content"
        case 400: reason = "Bad Request"
        case 404: reason = "Not Found"
        default:  reason = "OK"
        }
        let header = [
            "HTTP/1.1 \(statusCode) \(reason)",
            "Content-Type: application/json",
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type",
            "Access-Control-Allow-Private-Network: true",
            "Content-Length: \(bodyBytes.count)",
            "Connection: close",
            "", "",
        ].joined(separator: "\r\n")
        var out = Data(header.utf8)
        out.append(bodyBytes)
        return out
    }

    private func json(_ key: String, _ value: String) -> String {
        let safe = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"\(key)\":\"\(safe)\"}"
    }

    private func jsonError(_ msg: String) -> String {
        let safe = msg
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"error\":\"\(safe)\"}"
    }

    private func jsonSerializeStrings(_ items: [String]) -> String {
        let escaped = items.map {
            "\"" + $0
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"") + "\""
        }
        return "[" + escaped.joined(separator: ",") + "]"
    }

    private func parseInt(qs: String, key: String, default def: Int) -> Int {
        let pattern = "(?:^|&)\(NSRegularExpression.escapedPattern(for: key))=(\\d+)"
        guard let range = qs.range(of: pattern, options: .regularExpression) else { return def }
        let match = String(qs[range])
        guard let eqIdx = match.firstIndex(of: "=") else { return def }
        return Int(match[match.index(after: eqIdx)...]) ?? def
    }

    private func parseStr(qs: String, key: String) -> String {
        let pattern = "(?:^|&)\(NSRegularExpression.escapedPattern(for: key))=([^&]*)"
        guard let range = qs.range(of: pattern, options: .regularExpression) else { return "" }
        let match = String(qs[range])
        guard let eqIdx = match.firstIndex(of: "=") else { return "" }
        let raw = String(match[match.index(after: eqIdx)...])
        return raw.removingPercentEncoding?.replacingOccurrences(of: "+", with: " ") ?? raw
    }

    private func parseThemeColors(_ qs: String) -> [String: String] {
        var colors: [String: String] = [:]
        for key in ["bg", "bgW", "card", "text", "tSoft", "tFaint",
                    "brd", "brdS", "primary", "onPrimary", "tonal", "onTonal"] {
            let v = parseStr(qs: qs, key: key)
            if !v.isEmpty { colors[key] = v }
        }
        return colors
    }

    private func addLog(_ line: String) {
        let fmt = ISO8601DateFormatter()
        let entry = "[\(fmt.string(from: Date()))] \(line)"
        logLock.lock()
        _logEntries.append(entry)
        if _logEntries.count > 500 { _logEntries.removeFirst(_logEntries.count - 500) }
        logLock.unlock()
    }
}

extension Notification.Name {
    static let deskPhoneThemeChanged = Notification.Name("com.addedlife.deskphone.themeChanged")
}
