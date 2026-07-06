package com.shamash.phonehost.api

import com.shamash.phonehost.HostLog
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

/**
 * The Shamash local host API on port 8765 — same contract as the Windows
 * host's ControlApiService (raw-socket HTTP, CORS + Private Network Access
 * headers so the https web app may call it).
 *
 * Binds all interfaces, like Windows: 127.0.0.1 serves the browser on this
 * tablet; the LAN address serves other devices (the iPad lane) without the
 * cloud relay.
 */
class LocalApiServer(
    private val port: Int = 8765,
    private val log: (String) -> Unit = { HostLog.add(it) },
) {
    class Request(
        val method: String,
        val path: String,
        val query: Map<String, String>,
        val body: String,
        val headers: Map<String, String> = emptyMap(),
    ) {
        fun qs(name: String, default: String = ""): String = query[name] ?: default
        fun qsInt(name: String, default: Int): Int = query[name]?.toIntOrNull() ?: default

        /** X-Host-Token header — the paired-device credential. */
        val hostToken: String? get() = headers["x-host-token"]

        /** Authorization: Bearer <Firebase ID token> — used only by /pair. */
        val bearerToken: String?
            get() = headers["authorization"]
                ?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }
                ?.substring(7)?.trim()
    }

    class Response(val status: Int, val body: String)

    /** Route handler: return null → 404. */
    var handler: ((Request) -> Response?)? = null

    @Volatile
    var isRunning = false
        private set
    var startupResult = ""
        private set

    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null

    fun start() {
        if (isRunning) return
        try {
            serverSocket = ServerSocket(port)
            isRunning = true
            acceptThread = Thread({ acceptLoop() }, "api-accept").apply {
                isDaemon = true
                start()
            }
            startupResult = "OK — listening on http://0.0.0.0:$port/"
            log("[API] $startupResult")
        } catch (ex: Exception) {
            startupResult = "FAILED — ${ex.javaClass.simpleName}: ${ex.message}"
            log("[API] $startupResult")
        }
    }

    fun stop() {
        isRunning = false
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
    }

    private fun acceptLoop() {
        while (isRunning) {
            try {
                val client = serverSocket?.accept() ?: break
                Thread({ handleClient(client) }, "api-client").apply {
                    isDaemon = true
                    start()
                }
            } catch (ex: Exception) {
                if (isRunning) log("[API] accept error: ${ex.message}")
            }
        }
    }

    private fun handleClient(client: Socket) {
        client.use { sock ->
            try {
                sock.soTimeout = 15_000
                val input = BufferedReader(InputStreamReader(sock.getInputStream(), Charsets.UTF_8))
                val output = sock.getOutputStream()

                val requestLine = input.readLine() ?: return
                val headers = HashMap<String, String>()
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] =
                        line.substring(colon + 1).trim()
                }

                val parts = requestLine.split(' ')
                if (parts.size < 2) return
                val method = parts[0].uppercase()
                val rawPath = parts[1]
                val qmark = rawPath.indexOf('?')
                val path = (if (qmark < 0) rawPath else rawPath.substring(0, qmark)).lowercase()
                val query = parseQuery(if (qmark < 0) "" else rawPath.substring(qmark + 1))

                var body = ""
                val contentLength = headers["content-length"]?.toIntOrNull() ?: 0
                if (contentLength in 1..(12 * 1024 * 1024)) {
                    val buf = CharArray(contentLength)
                    var read = 0
                    while (read < contentLength) {
                        val n = input.read(buf, read, contentLength - read)
                        if (n <= 0) break
                        read += n
                    }
                    body = String(buf, 0, read)
                }

                if (method == "OPTIONS") {
                    writeResponse(output, 204, "")
                    return
                }

                val response = try {
                    handler?.invoke(Request(method, path, query, body, headers))
                } catch (ex: Exception) {
                    log("[API ERROR] $path: ${ex.javaClass.simpleName}: ${ex.message}")
                    Response(500, ApiJson.error(ex.message ?: "internal error"))
                }
                if (response == null) {
                    writeResponse(output, 404, ApiJson.error("unknown: $path"))
                } else {
                    writeResponse(output, response.status, response.body)
                }
            } catch (_: Exception) {
                // Connection dropped mid-request — nothing to clean up
            }
        }
    }

    private fun parseQuery(qs: String): Map<String, String> {
        if (qs.isEmpty()) return emptyMap()
        val map = HashMap<String, String>()
        for (pair in qs.split('&')) {
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            val key = URLDecoder.decode(pair.substring(0, eq), "UTF-8")
            val value = URLDecoder.decode(pair.substring(eq + 1), "UTF-8")
            map[key] = value
        }
        return map
    }

    private fun writeResponse(output: java.io.OutputStream, status: Int, body: String) {
        val bodyBytes = body.toByteArray(Charsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"; 204 -> "No Content"; 400 -> "Bad Request"
            401 -> "Unauthorized"; 403 -> "Forbidden"
            404 -> "Not Found"; 500 -> "Internal Server Error"; else -> "OK"
        }
        val head = "HTTP/1.1 $status $reason\r\n" +
            "Content-Type: application/json\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type, Authorization, X-Host-Token\r\n" +
            "Access-Control-Allow-Private-Network: true\r\n" +
            "Content-Length: ${bodyBytes.size}\r\n" +
            "Connection: close\r\n" +
            "\r\n"
        output.write(head.toByteArray(Charsets.US_ASCII))
        if (bodyBytes.isNotEmpty()) output.write(bodyBytes)
        output.flush()
    }
}
