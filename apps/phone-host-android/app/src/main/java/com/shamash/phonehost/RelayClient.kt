package com.shamash.phonehost

import com.shamash.phonehost.api.LocalApiServer
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Cloud relay for the Android host — the Kotlin twin of DeskPhone's RelayService.
 *
 * Whichever host holds the phone's Bluetooth link feeds the ONE cloud state doc
 * (Firestore phone-relay/state) and drains the ONE command mailbox (RTDB
 * phone-relay/commands). That single rule is the whole arbitration story:
 *
 *   - push/drain ONLY while fully connected — a parked host goes silent, so two
 *     hosts never fight over the doc and a command never executes twice;
 *   - one final push on the connected→disconnected edge, so remote surfaces see
 *     "offline" instead of data frozen at the moment the link dropped.
 *
 * With this in place every remote surface (PC browser, iPad, phone, anywhere)
 * just reads the cloud exactly as it always did with DeskPhone — no LAN
 * discovery, no proxies, and DeskPhone does not need to be running.
 *
 * State/command payload shapes are byte-compatible with RelayService.cs; the
 * web app cannot tell which host is feeding the relay (status.hostPlatform
 * says "android" and that is the only difference).
 *
 * Commands are executed through HostService.routeRequest — the same route
 * table the LAN API uses — so remote behavior can never drift from local.
 */
class RelayClient(private val host: HostService) {

    companion object {
        private const val FB_PROJECT = "onetaskonly-app"
        // The web API key is intentionally public (Firebase design; security is
        // enforced by Firestore/RTDB rules) — same key RelayService.cs ships.
        private const val FB_API_KEY = "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA"
        private const val FS_COMMIT_URL =
            "https://firestore.googleapis.com/v1/projects/$FB_PROJECT/databases/(default)/documents:commit?key=$FB_API_KEY"
        private const val STATE_DOC =
            "projects/$FB_PROJECT/databases/(default)/documents/phone-relay/state"
        private const val RTDB_COMMANDS_URL =
            "https://$FB_PROJECT-default-rtdb.firebaseio.com/phone-relay/commands.json"

        // Host arbitration (owner doc) — see phone-host-control.js / RelayService.cs.
        private const val OWNER_DOC =
            "projects/$FB_PROJECT/databases/(default)/documents/phone-relay/owner"
        private const val OWNER_GET_URL =
            "https://firestore.googleapis.com/v1/projects/$FB_PROJECT/databases/(default)/documents/phone-relay/owner?key=$FB_API_KEY"
        private const val HOST_ID = "android"
        private const val OWNER_HEARTBEAT_MS = 15_000L      // renew cadence while holding
        private const val OWNER_STALE_MS = 90_000L          // preferred host silent this long ⇒ dead
        private const val OWNER_TAKEOVER_GRACE_MS = 90_000L // brief yield after a switch before takeover
        private const val OWNER_SWITCH_POLL_MS = 5_000L     // faster poll while a handoff is in flight
        private const val OWNER_SWITCH_WINDOW_MS = 90_000L  // how long after a preference flip we poll fast

        private const val MESSAGE_RELAY_LIMIT = 150   // whole doc re-sent to every device on change
        private const val CALL_RELAY_LIMIT = 100
        private const val HEARTBEAT_MS = 300_000L     // backup push when nothing changed
        private const val TICK_MS = 3_000L            // change-detection cadence
        private const val DRAIN_MS = 4_000L           // RTDB GETs are free — bandwidth only
        private const val COMMAND_RESULT_LIMIT = 20
        private const val HTTP_TIMEOUT_MS = 8_000

        /** Same freshness rules as DeskPhone: a stale /dial must never ring someone
         *  in the middle of the night; everything else gets the 10-minute mailbox. */
        private fun commandTtlMs(path: String): Long = when (path) {
            "/dial", "/answer", "/hangup", "/toggle-mute", "/show" -> 45_000L
            else -> 600_000L
        }
    }

    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "relay-client").apply { isDaemon = true }
    }
    private val commandResults = ConcurrentLinkedQueue<JSONObject>()
    @Volatile private var lastPushedSignature = ""
    @Volatile private var lastPushAt = 0L
    @Volatile private var lastPushedConnected = false
    @Volatile private var pushNowRequested = false
    @Volatile private var pushErrors = 0
    @Volatile private var shouldHold = true   // default true = legacy "always try to hold"

    /** Whether THIS host should currently hold the phone (owner-doc arbitration).
     *  HostService's watchdog + startup connect gate on this so the tablet and the
     *  PC never fight over the phone's Bluetooth link. */
    fun shouldHoldPhone(): Boolean = shouldHold

    fun start() {
        executor.scheduleWithFixedDelay({ runCatching { pushTick() }.onFailure { logPushError(it) } },
            2, TICK_MS / 1000, TimeUnit.SECONDS)
        executor.scheduleWithFixedDelay({ runCatching { drainTick() } },
            5, DRAIN_MS / 1000, TimeUnit.SECONDS)
        executor.scheduleWithFixedDelay({ runCatching { arbitrationTick() } },
            3, OWNER_HEARTBEAT_MS / 1000, TimeUnit.SECONDS)
        HostLog.add("[RELAY] Client started — feeds the cloud while this host holds the phone link")
    }

    fun stop() {
        // Best-effort farewell so remote surfaces don't stare at frozen data.
        if (lastPushedConnected) runCatching { pushState() }
        executor.shutdownNow()
    }

    // ── Push: state → Firestore ───────────────────────────────────────────

    private fun pushTick() {
        val connected = host.isFullyConnected()
        if (!connected) {
            // One farewell push flips the cloud to "disconnected", then we go
            // silent — the link may now belong to another host (e.g. the PC).
            if (lastPushedConnected) {
                pushState()
                lastPushedConnected = false
            }
            return
        }
        val signature = host.routeRequest(getReq("/status"))?.body?.hashCode()?.toString() ?: return
        val now = System.currentTimeMillis()
        val due = pushNowRequested ||
            signature != lastPushedSignature ||
            now - lastPushAt >= HEARTBEAT_MS
        if (!due) return
        pushNowRequested = false
        pushState()
        lastPushedSignature = signature
        lastPushedConnected = true
    }

    private fun pushState() {
        val status = host.routeRequest(getReq("/status"))?.body ?: return
        val messages = host.routeRequest(getReq("/messages", "limit" to "$MESSAGE_RELAY_LIMIT"))?.body ?: "[]"
        val calls = host.routeRequest(getReq("/calls", "limit" to "$CALL_RELAY_LIMIT"))?.body ?: "[]"
        val contacts = host.routeRequest(getReq("/contacts"))?.body ?: "[]"
        val results = JSONArray().also { arr -> commandResults.forEach { arr.put(it) } }
        val nowMs = System.currentTimeMillis()

        val state = StringBuilder(256 * 1024)
            .append("{\"status\":").append(status)
            .append(",\"messages\":").append(messages)
            .append(",\"calls\":").append(calls)
            .append(",\"contacts\":").append(contacts)
            .append(",\"commandResults\":").append(results)
            .append(",\"lanUrl\":").append(JSONObject.quote(host.lanUrl() ?: ""))
            .append(",\"pushedAt\":").append(nowMs)
            .append(",\"relayReceivedAt\":").append(nowMs)
            .append('}').toString()

        // documents:commit is plain POST (HttpURLConnection has no PATCH verb);
        // the updateMask keeps it an update-in-place of the single `data` field.
        val body = JSONObject()
            .put("writes", JSONArray().put(JSONObject()
                .put("update", JSONObject()
                    .put("name", STATE_DOC)
                    .put("fields", JSONObject()
                        .put("data", JSONObject().put("stringValue", state))))
                .put("updateMask", JSONObject()
                    .put("fieldPaths", JSONArray().put("data")))))
            .toString()

        val code = httpSend("POST", FS_COMMIT_URL, body)
        if (code in 200..299) {
            lastPushAt = System.currentTimeMillis()
            pushErrors = 0
        } else {
            throw IllegalStateException("Firestore commit HTTP $code")
        }
    }

    private fun logPushError(ex: Throwable) {
        pushErrors++
        if (pushErrors <= 3) HostLog.add("[RELAY PUSH] ${ex.javaClass.simpleName}: ${ex.message}")
    }

    // ── Drain: RTDB command mailbox → routeRequest ────────────────────────

    private fun drainTick() {
        if (!host.isFullyConnected()) return   // parked host: the mailbox belongs to the live host
        val raw = httpGet(RTDB_COMMANDS_URL) ?: return
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || trimmed == "null" || trimmed == "[]" || trimmed == "{}") return

        // Clear BEFORE dispatch so a slow command can't be re-read and re-run.
        httpSend("PUT", RTDB_COMMANDS_URL, "null")

        for (cmd in normalizeRtdbArray(trimmed)) {
            val rawPath = cmd.optString("path")
            if (rawPath.isBlank()) continue
            val id = cmd.optString("id")
            val queuedAt = cmd.optLong("queuedAt", 0L)
            executeCommand(rawPath, id, queuedAt)
        }
    }

    /** RTDB stores arrays as {"0":{...},"1":{...}} once keys go sparse — accept both. */
    private fun normalizeRtdbArray(body: String): List<JSONObject> = try {
        when {
            body.startsWith("[") -> {
                val arr = JSONArray(body)
                (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
            }
            body.startsWith("{") -> {
                val obj = JSONObject(body)
                obj.keys().asSequence()
                    .sortedBy { it.toIntOrNull() ?: Int.MAX_VALUE }
                    .mapNotNull { obj.optJSONObject(it) }.toList()
            }
            else -> emptyList()
        }
    } catch (_: Exception) { emptyList() }

    private fun executeCommand(rawPath: String, id: String, queuedAtMs: Long) {
        val qmark = rawPath.indexOf('?')
        val path = (if (qmark < 0) rawPath else rawPath.substring(0, qmark)).lowercase()
        val query = parseQuery(if (qmark < 0) "" else rawPath.substring(qmark + 1))
        HostLog.add("[RELAY CMD] $path")

        // Same fail-safes as DeskPhone: no timestamp = unprovable freshness = refused;
        // expired call actions are refused rather than ringing someone hours late.
        if (queuedAtMs <= 0) {
            recordResult(id, path, ok = false, error = "no queue timestamp — treated as expired")
            return
        }
        if (System.currentTimeMillis() - queuedAtMs > commandTtlMs(path)) {
            recordResult(id, path, ok = false, error = "expired before the host was online")
            return
        }

        val resp = try {
            host.routeRequest(LocalApiServer.Request("POST", path, query, ""))
        } catch (ex: Exception) {
            recordResult(id, path, ok = false, error = ex.message ?: "command failed")
            return
        }
        when {
            resp == null ->
                recordResult(id, path, ok = false, error = "not supported on the Android host")
            resp.status != 200 || resp.body.contains("\"failed\"") || resp.body.contains("\"error\"") ->
                recordResult(id, path, ok = false, error = "host returned ${resp.status}")
            else -> recordResult(id, path, ok = true, error = null)
        }
    }

    private fun recordResult(id: String, path: String, ok: Boolean, error: String?) {
        if (id.isNotBlank()) {
            commandResults.add(JSONObject()
                .put("id", id).put("path", path).put("ok", ok)
                .put("error", error ?: "").put("completedAt", System.currentTimeMillis()))
            while (commandResults.size > COMMAND_RESULT_LIMIT) commandResults.poll()
        }
        pushNowRequested = true   // ack (and any state change) rides the next tick, ≤3 s away
    }

    private fun parseQuery(qs: String): Map<String, String> =
        qs.split('&').filter { it.contains('=') }.associate {
            val i = it.indexOf('=')
            URLDecoder.decode(it.substring(0, i), "UTF-8") to
                URLDecoder.decode(it.substring(i + 1), "UTF-8")
        }

    private fun getReq(path: String, vararg query: Pair<String, String>) =
        LocalApiServer.Request("GET", path, query.toMap(), "")

    // ── Host arbitration (owner doc: phone-relay/owner) ───────────────────────
    /** Read the owner doc, decide whether this host should hold the phone, and —
     *  while holding — renew the heartbeat. Additive & safe: a non-preferred host
     *  never grabs (the watchdog gates on shouldHoldPhone()); nothing is torn down. */
    fun evaluateShouldHold() = arbitrationTick()

    @Volatile private var fastTickQueued = false

    private fun arbitrationTick() {
        fastTickQueued = false
        var preferred = "tablet"; var ownerHost = ""; var ownerT = 0L; var preferredAt = 0L; var ownerConnected = false
        val raw = httpGet(OWNER_GET_URL)
        if (raw != null && raw.trim().startsWith("{")) {
            try {
                JSONObject(raw).optJSONObject("fields")?.let { f ->
                    preferred = f.optJSONObject("preferred")?.optString("stringValue") ?: "tablet"
                    ownerHost = f.optJSONObject("host")?.optString("stringValue") ?: ""
                    ownerT = f.optJSONObject("t")?.optString("integerValue")?.toLongOrNull() ?: 0L
                    preferredAt = f.optJSONObject("preferredAtMs")?.optString("integerValue")?.toLongOrNull() ?: 0L
                    ownerConnected = f.optJSONObject("connected")?.optBoolean("booleanValue") ?: false
                }
            } catch (_: Exception) {}
        }
        val now = System.currentTimeMillis()
        // preferred "pc" ⇒ the Windows host should hold; "tablet" ⇒ this Android host.
        val preferredId = if (preferred == "pc") "windows" else "android"
        val amPreferred = preferredId == HOST_ID
        val preferredFresh = ownerHost == preferredId && (now - ownerT) < OWNER_STALE_MS && ownerConnected
        val wasHolding = shouldHold
        shouldHold = when {
            amPreferred    -> true                                     // I'm the chosen host — always try
            preferredFresh -> false                                    // preferred host alive & holding — stay parked
            else           -> (now - preferredAt) >= OWNER_TAKEOVER_GRACE_MS  // brief yield after a switch, else take over
        }
        val withinSwitchWindow = (now - preferredAt) in 0 until OWNER_SWITCH_WINDOW_MS
        val connected = host.isFullyConnected()

        if (shouldHold) {
            // Only the intended holder writes — a parked host writing host=android would
            // clobber the PC's ownership. While holding, renew the heartbeat.
            writeOwnerHeartbeat(now, connected)
            // Acquire: we hold (or just won) the phone but aren't connected. During the
            // switch window this retries each fast tick — early attempts lose the race
            // with the PC's release, and the phone needs seconds to free the profiles.
            // connectToDefault() clears the `released` parking flag and has its own
            // `connecting` in-flight guard, so repeats are safe.
            if ((!wasHolding || withinSwitchWindow) && !connected && !host.isBusyConnecting()) {
                HostLog.add("[ARBITRATION] this host is now preferred — connecting to the phone")
                host.connectToDefault()
            }
        } else if (connected && withinSwitchWindow) {
            // Resign-then-acquire: the phone serves HFP/MAP to ONE host at a time, so
            // the PC can only take over if we actively drop the link. Only a FRESH
            // explicit preference flip triggers this (a stale doc never yanks a working
            // connection), and never mid-call — we re-check every fast tick until idle.
            if (host.isCallActive()) {
                HostLog.add("[ARBITRATION] release requested but a call is live — deferring until idle")
            } else {
                HostLog.add("[ARBITRATION] preferred host changed — releasing the phone's Bluetooth link")
                host.handoffRelease()
                // Farewell: we were the recorded holder — flip connected=false so the
                // web and the winning host see the link drop within one fast tick.
                if (ownerHost == HOST_ID) writeOwnerHeartbeat(System.currentTimeMillis(), false)
            }
        }

        // A handoff in flight polls fast so both hosts converge in seconds. One-shot
        // reschedule (guarded) on top of the fixed 15s cadence.
        if (withinSwitchWindow && !fastTickQueued) {
            fastTickQueued = true
            executor.schedule({ runCatching { arbitrationTick() } }, OWNER_SWITCH_POLL_MS, TimeUnit.MILLISECONDS)
        }
    }

    private fun writeOwnerHeartbeat(nowMs: Long, connected: Boolean) {
        val body = JSONObject()
            .put("writes", JSONArray().put(JSONObject()
                .put("update", JSONObject()
                    .put("name", OWNER_DOC)
                    .put("fields", JSONObject()
                        .put("host", JSONObject().put("stringValue", HOST_ID))
                        .put("t", JSONObject().put("integerValue", nowMs.toString()))
                        .put("connected", JSONObject().put("booleanValue", connected))))
                .put("updateMask", JSONObject()
                    .put("fieldPaths", JSONArray().put("host").put("t").put("connected")))))
            .toString()
        val code = httpSend("POST", FS_COMMIT_URL, body)
        if (code !in 200..299) HostLog.add("[ARBITRATION] owner heartbeat HTTP $code")
    }

    // ── Tiny HTTP helpers (framework-only, matching the project's no-deps rule) ──

    private fun httpGet(url: String): String? = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = HTTP_TIMEOUT_MS
        conn.readTimeout = HTTP_TIMEOUT_MS
        if (conn.responseCode in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else null
    } catch (_: Exception) { null }

    private fun httpSend(method: String, url: String, body: String): Int = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = HTTP_TIMEOUT_MS
        conn.readTimeout = HTTP_TIMEOUT_MS
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        runCatching { (if (code in 200..299) conn.inputStream else conn.errorStream)?.close() }
        code
    } catch (_: Exception) { -1 }
}
