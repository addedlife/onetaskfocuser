import Foundation
import UIKit

final class BridgeController {
    private let probe: BluetoothProbeService
    private let lanHost: LanHostClient?
    private let relay: RelayPresenceService?

    init(probe: BluetoothProbeService, lanHost: LanHostClient? = nil, relay: RelayPresenceService? = nil) {
        self.probe = probe
        self.lanHost = lanHost
        self.relay = relay
    }

    func handle(method: String, path: String, body: [String: Any]) -> (Int, [String: Any]) {
        let route = path.components(separatedBy: "?").first ?? "/"
        let query = Self.query(path)
        var payload = body
        query.forEach { key, value in
            if payload[key] == nil { payload[key] = value }
        }

        switch (method, route) {
        case ("OPTIONS", _):
            return (204, [:])
        case ("GET", "/"), ("GET", "/health"):
            return ok([
                "service": "webphone-ipad-phone-bridge-probe",
                "version": "0.2.0",
                "host": "127.0.0.1",
                "port": 8765,
                "independent": true,
                "deskPhoneRequired": false,
                "goal": "Probe whether this iPad can act as the Bluetooth MAP/PBAP/HFP client for the locked Android source phone."
            ])
        case ("GET", "/status"):
            return status()
        case ("GET", "/devices"):
            return ok(["value": probe.snapshot()["devices"] ?? [], "probe": probe.snapshot()])
        case ("GET", "/events"):
            return ok(["value": probe.snapshot()["events"] ?? [], "probe": probe.snapshot()])
        case ("POST", "/probe/start"), ("POST", "/scan-devices"), ("POST", "/refresh"):
            DispatchQueue.main.async { self.probe.startScan() }
            return ok(["result": "scan-started", "probe": probe.snapshot()])
        case ("POST", "/probe/stop"):
            DispatchQueue.main.async { self.probe.stopScan() }
            return ok(["result": "scan-stopped", "probe": probe.snapshot()])
        case ("POST", "/probe/connect"), ("POST", "/connect"):
            guard let idText = string(payload["id"]) ?? string(payload["deviceId"]),
                  let id = UUID(uuidString: idText) else {
                return (400, ["ok": false, "status": 400, "error": "Missing device UUID. Use /devices, then POST /probe/connect with {\"id\":\"...\"}."])
            }
            DispatchQueue.main.async { self.probe.probeDevice(id: id) }
            return ok(["result": "connect-started", "deviceId": id.uuidString, "probe": probe.snapshot()])
        case ("GET", "/lan-host"):
            return ok(["lanHost": lanHost?.snapshot() ?? NSNull()])
        case ("POST", "/lan-host"):
            guard let host = string(payload["host"]) else {
                return (400, ["ok": false, "status": 400, "error": "Missing host. POST /lan-host with {\"host\":\"192.168.1.20\"} (port defaults to 8765)."])
            }
            lanHost?.manualHost = host.isEmpty ? nil : host
            return ok(["result": "manual LAN host updated", "lanHost": lanHost?.snapshot() ?? NSNull()])
        case ("GET", "/contacts"):
            return reserved("PBAP contact export is reserved until the iPad probe opens the phone's PBAP server.")
        case ("GET", "/calls"):
            return reserved("PBAP call-history export is reserved until the iPad probe opens the phone's PBAP server.")
        case ("GET", "/messages"):
            return reserved("MAP message export is reserved until the iPad probe opens the phone's MAP server.")
        case ("POST", "/dial"), ("POST", "/send"), ("POST", "/sms/send"), ("POST", "/send-message"):
            return reserved("Phone-side commands are reserved until MAP/HFP capability is proven on this iPad.")
        default:
            return (404, ["ok": false, "status": 404, "error": "Unknown endpoint: \(method) \(route)"])
        }
    }

    private func status() -> (Int, [String: Any]) {
        let probeSnapshot = probe.snapshot()
        return ok([
            "build": "iPad Phone Bridge Probe 0.2.0",
            "connected": false,
            "hostOsType": "iPadOS",
            "hostConnector": "iPad Bluetooth probe",
            "remotePhone": [
                "contacts": 0,
                "calls": 0,
                "messages": 0,
                "live": false
            ],
            "server": ["host": "127.0.0.1", "port": 8765],
            "ios": [
                "system": UIDevice.current.systemName,
                "version": UIDevice.current.systemVersion,
                "model": UIDevice.current.model
            ],
            "probe": probeSnapshot,
            "lanHost": lanHost?.snapshot() ?? NSNull(),
            "cloudRelay": relay?.snapshot() ?? NSNull(),
            "nextMilestone": "Direct Bluetooth is gated on the probe; live path is the LAN proxy to whichever host holds the phone link, feeding the shared cloud relay."
        ])
    }

    private func reserved(_ message: String) -> (Int, [String: Any]) {
        (501, [
            "ok": false,
            "status": 501,
            "error": message,
            "probe": probe.snapshot()
        ])
    }

    private func ok(_ data: [String: Any]) -> (Int, [String: Any]) {
        var result = data
        result["ok"] = true
        return (200, result)
    }

    private func string(_ value: Any?) -> String? {
        if let text = value as? String { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func query(_ path: String) -> [String: String] {
        guard let components = URLComponents(string: "http://127.0.0.1\(path)") else { return [:] }
        var values: [String: String] = [:]
        for item in components.queryItems ?? [] {
            values[item.name] = item.value ?? ""
        }
        return values
    }
}
