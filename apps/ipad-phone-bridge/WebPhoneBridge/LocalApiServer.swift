import Foundation
import Network

final class LocalApiServer {
    private let port: UInt16
    private let controller: BridgeController
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "webphone.ipad.bridge.api")

    init(port: UInt16, controller: BridgeController) {
        self.port = port
        self.controller = controller
    }

    func start() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(IPv4Address("127.0.0.1")!), port: NWEndpoint.Port(rawValue: port)!)
        let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, _ in
            guard let self else { return }
            let request = HTTPRequest(data: data ?? Data())
            let result = self.controller.handle(method: request.method, path: request.path, body: request.jsonBody)
            self.send(result.0, result.1, on: connection)
        }
    }

    private func send(_ status: Int, _ payload: [String: Any], on connection: NWConnection) {
        let body = (try? JSONSerialization.data(withJSONObject: payload, options: [])) ?? Data("{}".utf8)
        let reason = Self.reason(status)
        let headers = """
        HTTP/1.1 \(status) \(reason)\r
        Content-Type: application/json; charset=utf-8\r
        Content-Length: \(body.count)\r
        Access-Control-Allow-Origin: *\r
        Access-Control-Allow-Methods: GET, POST, OPTIONS\r
        Access-Control-Allow-Headers: Content-Type\r
        Access-Control-Allow-Private-Network: true\r
        Connection: close\r
        \r

        """
        var response = Data(headers.utf8)
        response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private static func reason(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 204: return "No Content"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 500: return "Server Error"
        case 501: return "Not Implemented"
        default: return "Status"
        }
    }
}

private struct HTTPRequest {
    let method: String
    let path: String
    let jsonBody: [String: Any]

    init(data: Data) {
        let text = String(data: data, encoding: .utf8) ?? ""
        let parts = text.components(separatedBy: "\r\n\r\n")
        let head = parts.first ?? ""
        let body = parts.dropFirst().joined(separator: "\r\n\r\n")
        let requestLine = head.components(separatedBy: "\r\n").first ?? "GET / HTTP/1.1"
        let tokens = requestLine.components(separatedBy: " ")
        self.method = tokens.indices.contains(0) ? tokens[0].uppercased() : "GET"
        self.path = tokens.indices.contains(1) ? tokens[1] : "/"
        if let bodyData = body.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: bodyData) as? [String: Any] {
            self.jsonBody = json
        } else {
            self.jsonBody = [:]
        }
    }
}
