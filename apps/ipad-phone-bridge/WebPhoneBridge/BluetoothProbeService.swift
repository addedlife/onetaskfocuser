import CoreBluetooth
import Foundation

struct ProbeEvent: Identifiable {
    let id = UUID()
    let date = Date()
    let level: String
    let message: String

    func dictionary() -> [String: Any] {
        [
            "id": id.uuidString,
            "at": ISO8601DateFormatter().string(from: date),
            "level": level,
            "message": message
        ]
    }
}

struct ProbeProfileStatus {
    let key: String
    let name: String
    let uuid: String
    let purpose: String
    var discovered: Bool = false
    var detail: String = "Not seen yet"

    func dictionary() -> [String: Any] {
        [
            "key": key,
            "name": name,
            "uuid": uuid,
            "purpose": purpose,
            "discovered": discovered,
            "detail": detail
        ]
    }
}

struct ProbeDevice: Identifiable {
    let id: UUID
    var name: String
    var rssi: Int
    var advertisementKeys: [String]
    var services: [String]
    var lastSeen: Date

    func dictionary() -> [String: Any] {
        [
            "id": id.uuidString,
            "name": name,
            "rssi": rssi,
            "advertisementKeys": advertisementKeys,
            "services": services,
            "lastSeen": ISO8601DateFormatter().string(from: lastSeen)
        ]
    }
}

final class BluetoothProbeService: NSObject, ObservableObject {
    @Published private(set) var bluetoothState = "unknown"
    @Published private(set) var isScanning = false
    @Published private(set) var devices: [ProbeDevice] = []
    @Published private(set) var events: [ProbeEvent] = []
    @Published private(set) var profileStatuses: [ProbeProfileStatus] = Self.initialProfiles

    private var central: CBCentralManager?
    private var peripherals: [UUID: CBPeripheral] = [:]
    private let eventLimit = 120

    private static let initialProfiles: [ProbeProfileStatus] = [
        ProbeProfileStatus(
            key: "pbap-pse",
            name: "PBAP Phone Book Server",
            uuid: "112F",
            purpose: "Remote phone contacts and call history"
        ),
        ProbeProfileStatus(
            key: "map-mas",
            name: "MAP Message Access Server",
            uuid: "1132",
            purpose: "Remote phone message listing and message bodies"
        ),
        ProbeProfileStatus(
            key: "map-mns",
            name: "MAP Message Notification Service",
            uuid: "1133",
            purpose: "Live message events from the phone"
        ),
        ProbeProfileStatus(
            key: "hfp-ag",
            name: "HFP Audio Gateway",
            uuid: "111F",
            purpose: "Remote phone call state and possible audio gateway"
        ),
        ProbeProfileStatus(
            key: "hfp-hf",
            name: "HFP Hands-Free",
            uuid: "111E",
            purpose: "Hands-free client/service-level signaling"
        )
    ]

    override init() {
        super.init()
        addEvent("info", "Bluetooth probe service created.")
    }

    func activate() {
        if central != nil { return }
        central = CBCentralManager(delegate: self, queue: .main)
        addEvent("info", "CoreBluetooth manager activated.")
    }

    func startScan() {
        activate()
        guard let central else { return }
        guard central.state == .poweredOn else {
            addEvent("warn", "Bluetooth is not powered on yet: \(bluetoothState).")
            return
        }
        isScanning = true
        devices.removeAll()
        profileStatuses = Self.initialProfiles
        peripherals.removeAll()
        addEvent("info", "Scanning for nearby Bluetooth devices. Pair the Android phone in Settings first if it does not appear.")
        central.scanForPeripherals(
            withServices: nil,
            options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
        )
    }

    func stopScan() {
        central?.stopScan()
        isScanning = false
        addEvent("info", "Bluetooth scan stopped.")
    }

    func probeDevice(id: UUID) {
        guard let central else {
            addEvent("error", "Bluetooth manager is not active.")
            return
        }
        guard let peripheral = peripherals[id] else {
            addEvent("error", "Selected Bluetooth device is no longer in the scan cache.")
            return
        }
        peripheral.delegate = self
        addEvent("info", "Connecting to \(peripheral.name ?? id.uuidString) to discover MAP/PBAP/HFP services.")
        central.connect(peripheral, options: nil)
    }

    func snapshot() -> [String: Any] {
        [
            "state": bluetoothState,
            "isScanning": isScanning,
            "devices": devices.map { $0.dictionary() },
            "profiles": profileStatuses.map { $0.dictionary() },
            "events": events.map { $0.dictionary() },
            "probeLimit": "Public CoreBluetooth probe. If iPadOS does not surface MAP/PBAP/HFP services here, the next lane is private entitlement/MFi research, not web code."
        ]
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothState = Self.describe(central.state)
        addEvent("info", "Bluetooth state: \(bluetoothState).")
        if central.state != .poweredOn {
            isScanning = false
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        peripherals[peripheral.identifier] = peripheral
        let advertisedServices = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? [])
            .map { $0.uuidString }
        let next = ProbeDevice(
            id: peripheral.identifier,
            name: peripheral.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? "Unnamed device",
            rssi: RSSI.intValue,
            advertisementKeys: advertisementData.keys.sorted(),
            services: advertisedServices,
            lastSeen: Date()
        )
        if let index = devices.firstIndex(where: { $0.id == next.id }) {
            devices[index] = next
        } else {
            devices.append(next)
            addEvent("info", "Discovered \(next.name) RSSI \(next.rssi).")
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        addEvent("info", "Connected to \(peripheral.name ?? peripheral.identifier.uuidString). Discovering target services.")
        let serviceUUIDs = profileStatuses.map { CBUUID(string: $0.uuid) }
        peripheral.discoverServices(serviceUUIDs)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        addEvent("error", "Failed to connect to \(peripheral.name ?? peripheral.identifier.uuidString): \(error?.localizedDescription ?? "unknown error").")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        addEvent("warn", "Disconnected from \(peripheral.name ?? peripheral.identifier.uuidString): \(error?.localizedDescription ?? "normal disconnect").")
    }

    private func addEvent(_ level: String, _ message: String) {
        events.insert(ProbeEvent(level: level, message: message), at: 0)
        if events.count > eventLimit {
            events.removeLast(events.count - eventLimit)
        }
    }

    private static func describe(_ state: CBManagerState) -> String {
        switch state {
        case .poweredOn: return "poweredOn"
        case .poweredOff: return "poweredOff"
        case .resetting: return "resetting"
        case .unauthorized: return "unauthorized"
        case .unsupported: return "unsupported"
        case .unknown: fallthrough
        @unknown default: return "unknown"
        }
    }
}

extension BluetoothProbeService: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error {
            addEvent("error", "Service discovery failed: \(error.localizedDescription).")
            return
        }
        let found = Set((peripheral.services ?? []).map { $0.uuid.uuidString.uppercased() })
        if found.isEmpty {
            addEvent("warn", "No target services were surfaced through CoreBluetooth service discovery.")
        }
        for index in profileStatuses.indices {
            let uuid = profileStatuses[index].uuid.uppercased()
            if found.contains(uuid) {
                profileStatuses[index].discovered = true
                profileStatuses[index].detail = "Surfaced by CoreBluetooth service discovery"
                addEvent("info", "Found \(profileStatuses[index].name) (\(uuid)).")
            } else {
                profileStatuses[index].detail = "Not surfaced by CoreBluetooth"
            }
        }
        for service in peripheral.services ?? [] {
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let error {
            addEvent("warn", "Characteristic discovery failed for \(service.uuid.uuidString): \(error.localizedDescription).")
            return
        }
        let count = service.characteristics?.count ?? 0
        addEvent("info", "Service \(service.uuid.uuidString) exposed \(count) characteristics.")
    }
}
