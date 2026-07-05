import Combine
import Foundation
import Network

/// Discovers the active Shamash phone host (Windows PC or Android tablet)
/// on the local network via Bonjour (`_shamash-phonehost._tcp`) and proxies
/// host-contract requests to it.
///
/// Why this exists: iPadOS public APIs cannot open the Bluetooth Classic
/// MAP/PBAP/HFP channels to the phone (see BluetoothProbeService's decision
/// gate), but a native app CAN talk plain HTTP to whichever host currently
/// holds the Bluetooth link — no cloud relay, and no https mixed-content
/// limits that block the web app from calling a LAN address directly.
/// The web app on this iPad keeps calling http://127.0.0.1:8765 unchanged;
/// LocalApiServer forwards through this client when a LAN host is present.
final class LanHostClient: ObservableObject {
    @Published private(set) var activeHost: String? // "192.168.1.20:8765"
    @Published private(set) var lastError: String?

    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "webphone.ipad.bridge.lanhost")
    private let session: URLSession

    /// Manual fallback host ("192.168.1.20" or "192.168.1.20:8765"),
    /// settable through POST /lan-host for networks where mDNS is filtered.
    var manualHost: String? {
        didSet { recomputeActiveHost() }
    }

    private var discoveredHost: String? {
        didSet { recomputeActiveHost() }
    }

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    func start() {
        let descriptor = NWBrowser.Descriptor.bonjour(type: "_shamash-phonehost._tcp", domain: nil)
        let browser = NWBrowser(for: descriptor, using: .tcp)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.resolveFirst(results: results)
        }
        browser.stateUpdateHandler = { [weak self] state in
            if case .failed(let error) = state {
                self?.lastError = "Bonjour browse failed: \(error.localizedDescription)"
            }
        }
        browser.start(queue: queue)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
    }

    private func resolveFirst(results: Set<NWBrowser.Result>) {
        guard let first = results.first else {
            DispatchQueue.main.async { self.discoveredHost = nil }
            return
        }
        // Resolve the endpoint to a concrete IPv4 host:port with a short probe connection.
        let connection = NWConnection(to: first.endpoint, using: .tcp)
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            if case .ready = state {
                if let path = connection.currentPath,
                   let endpoint = path.remoteEndpoint,
                   case let .hostPort(host, port) = endpoint {
                    let hostText = Self.hostText(host)
                    DispatchQueue.main.async {
                        self.discoveredHost = "\(hostText):\(port.rawValue)"
                    }
                }
                connection.cancel()
            }
            if case .failed = state { connection.cancel() }
        }
        connection.start(queue: queue)
    }

    private static func hostText(_ host: NWEndpoint.Host) -> String {
        switch host {
        case .ipv4(let address): return "\(address)"
        case .ipv6(let address): return "[\(address)]"
        case .name(let name, _): return name
        @unknown default: return "\(host)"
        }
    }

    private func recomputeActiveHost() {
        var candidate = discoveredHost ?? manualHost
        if let raw = candidate, !raw.contains(":") { candidate = raw + ":8765" }
        DispatchQueue.main.async { self.activeHost = candidate }
    }

    /// Forward a host-contract request as-is; returns nil when no LAN host is
    /// reachable so the caller can fall back to local probe handling.
    func forward(method: String, path: String, body: Data?) -> (Int, Data)? {
        guard let host = activeHost, let url = URL(string: "http://\(host)\(path)") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body, !body.isEmpty {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var result: (Int, Data)?
        let task = session.dataTask(with: request) { data, response, error in
            defer { semaphore.signal() }
            if error != nil { return }
            guard let http = response as? HTTPURLResponse else { return }
            result = (http.statusCode, data ?? Data())
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 9)
        if result == nil {
            DispatchQueue.main.async { self.lastError = "LAN host \(host) unreachable" }
        }
        return result
    }

    func snapshot() -> [String: Any] {
        [
            "activeHost": activeHost ?? NSNull(),
            "discoveredHost": discoveredHost ?? NSNull(),
            "manualHost": manualHost ?? NSNull(),
            "lastError": lastError ?? NSNull(),
            "transport": "LAN HTTP proxy to the host holding the phone's Bluetooth link (no cloud relay)"
        ]
    }
}
