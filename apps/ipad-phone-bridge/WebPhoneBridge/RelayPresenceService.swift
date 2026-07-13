import Foundation

/// The iPad's cloud lane — makes this bridge a genuine third phone link that
/// feeds the SAME Firestore relay as the Android and PC hosts.
///
/// Two jobs, both direct Firestore REST writes with the public web API key
/// (identical trust model to RelayService.cs / RelayClient.kt — the key is
/// public by Firebase design; rules gate what it can touch):
///
///  1. **Presence** (always, every ~20 s): PATCH `phone-relay/owner` field
///     `hosts.ios = { t, connected, quality }` — the auto-finder's input, so
///     every arbiter (web, Windows, Android) can see and score the iPad lane.
///     `connected` mirrors the LAN-proxied host's own phone-connection state;
///     quality: 100 = proxying a live host, 40 = a host answers but its phone
///     link is down, 0 = no LAN host (entry goes stale and scores 0 anyway).
///
///  2. **State push** (only while the owner toggle says `preferred == "ipad"`):
///     fetch `/status /messages /calls /contacts` through the LAN proxy, wrap
///     them in the exact state-blob shape DeskPhone pushes, and PATCH
///     `phone-relay/state`. Every remote browser then reads the phone feed
///     through the iPad — the "iPad" segment on the web rail is this lane.
///
/// The iPad can never hold the phone's Bluetooth Classic link itself
/// (BluetoothProbeService's decision gate; no public RFCOMM on iPadOS), so
/// presence advertises a FEEDER lane: the BT-capable hosts keep arbitrating
/// the physical link among themselves even while the iPad fronts the cloud.
final class RelayPresenceService {
    private static let fbProject = "onetaskonly-app"
    // Public by Firebase design — the same key the other two hosts ship.
    private static let fbApiKey = "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA"
    private static let fsBase =
        "https://firestore.googleapis.com/v1/projects/\(fbProject)/databases/(default)/documents"
    private static let hostId = "ios"
    private static let tickSeconds: TimeInterval = 20

    private let lanHost: LanHostClient
    private var timer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "webphone.ipad.bridge.relay")
    private let session: URLSession

    private(set) var lastPresenceStatus: Int = 0
    private(set) var lastStatePushAtMs: Int64 = 0
    private(set) var preferred: String = ""

    init(lanHost: LanHostClient) {
        self.lanHost = lanHost
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        session = URLSession(configuration: config)
    }

    func start() {
        guard timer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 2, repeating: Self.tickSeconds)
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    func snapshot() -> [String: Any] {
        [
            "hostId": Self.hostId,
            "lastPresenceStatus": lastPresenceStatus,
            "lastStatePushAtMs": lastStatePushAtMs,
            "preferred": preferred,
            "transport": "Firestore REST presence + state push (same relay as the Android/PC hosts)"
        ]
    }

    // ── One tick: presence always; state push while preferred == "ipad" ──────
    private func tick() {
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000)
        let hostStatus = fetchLanJson(path: "/status")
        let lanReachable = hostStatus != nil
        let phoneConnected = (hostStatus?["connected"] as? Bool) ?? false
        let quality = phoneConnected ? 100 : (lanReachable ? 40 : 0)

        writePresence(nowMs: nowMs, connected: phoneConnected, quality: quality)

        preferred = readPreferred() ?? preferred
        if preferred == "ipad", lanReachable {
            pushState(nowMs: nowMs, status: hostStatus)
        }
    }

    private func writePresence(nowMs: Int64, connected: Bool, quality: Int) {
        let fields: [String: Any] = [
            "hosts": ["mapValue": ["fields": [
                Self.hostId: ["mapValue": ["fields": [
                    "t": ["integerValue": String(nowMs)],
                    "connected": ["booleanValue": connected],
                    "quality": ["integerValue": String(quality)],
                ]]]
            ]]]
        ]
        let url = "\(Self.fsBase)/phone-relay/owner?key=\(Self.fbApiKey)" +
            "&updateMask.fieldPaths=hosts.\(Self.hostId)"
        lastPresenceStatus = patch(url: url, body: ["fields": fields])
    }

    private func readPreferred() -> String? {
        guard let doc = getJson(url: "\(Self.fsBase)/phone-relay/owner?key=\(Self.fbApiKey)"),
              let fields = doc["fields"] as? [String: Any],
              let pref = fields["preferred"] as? [String: Any] else { return nil }
        return pref["stringValue"] as? String
    }

    /// Mirror DeskPhone's state-blob shape exactly (RelayService.cs push):
    /// { status, messages, calls, contacts, commandResults, lanUrl, pushedAt, relayReceivedAt }
    private func pushState(nowMs: Int64, status: [String: Any]?) {
        func raw(_ path: String) -> Any {
            guard let (code, data) = lanHost.forward(method: "GET", path: path, body: nil),
                  code == 200,
                  let parsed = try? JSONSerialization.jsonObject(with: data) else { return [] as [Any] }
            return parsed
        }
        let blob: [String: Any] = [
            "status": status ?? [:],
            "messages": raw("/messages?limit=150"),
            "calls": raw("/calls"),
            "contacts": raw("/contacts"),
            "commandResults": [] as [Any],
            "lanUrl": "",
            "pushedAt": nowMs,
            "relayReceivedAt": nowMs,
        ]
        guard let blobData = try? JSONSerialization.data(withJSONObject: blob),
              let blobText = String(data: blobData, encoding: .utf8) else { return }
        let url = "\(Self.fsBase)/phone-relay/state?key=\(Self.fbApiKey)&updateMask.fieldPaths=data"
        let code = patch(url: url, body: ["fields": ["data": ["stringValue": blobText]]])
        if (200...299).contains(code) { lastStatePushAtMs = nowMs }
    }

    // ── Tiny HTTP helpers ─────────────────────────────────────────────────────
    private func fetchLanJson(path: String) -> [String: Any]? {
        guard let (code, data) = lanHost.forward(method: "GET", path: path, body: nil),
              code == 200 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    private func getJson(url: String) -> [String: Any]? {
        guard let u = URL(string: url) else { return nil }
        var result: [String: Any]?
        let semaphore = DispatchSemaphore(value: 0)
        session.dataTask(with: u) { data, response, _ in
            defer { semaphore.signal() }
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data else { return }
            result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        }.resume()
        _ = semaphore.wait(timeout: .now() + 9)
        return result
    }

    private func patch(url: String, body: [String: Any]) -> Int {
        guard let u = URL(string: url),
              let data = try? JSONSerialization.data(withJSONObject: body) else { return -1 }
        var request = URLRequest(url: u)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = data
        var status = -1
        let semaphore = DispatchSemaphore(value: 0)
        session.dataTask(with: request) { _, response, _ in
            defer { semaphore.signal() }
            if let http = response as? HTTPURLResponse { status = http.statusCode }
        }.resume()
        _ = semaphore.wait(timeout: .now() + 9)
        return status
    }
}
