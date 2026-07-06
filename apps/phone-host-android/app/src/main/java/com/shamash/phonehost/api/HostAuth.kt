package com.shamash.phonehost.api

import android.content.SharedPreferences
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.PublicKey
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

/**
 * One-stop auth for the host API, riding the owner's existing Google sign-in.
 *
 * Pairing flow (no codes, no extra logins):
 *  1. The web app — already signed into Firebase with the owner's Google
 *     account — POSTs its Firebase ID token to /pair.
 *  2. We verify the token's RS256 signature against Google's published
 *     securetoken certs (cached 12 h) and check iss/aud/exp for our project.
 *  3. First valid pairing claims the host (trust-on-first-use): that uid
 *     becomes the owner. Later pairings must present the same uid.
 *  4. We mint a random host token the client stores and sends as
 *     X-Host-Token on every call. Until a first pairing happens the API
 *     stays open, so existing clients are never locked out mid-rollout.
 *
 * Recovery: "Reset pairing" in the app's Advanced section clears the owner
 * uid + tokens (physical access to the tablet = permission to re-claim).
 */
class HostAuth(
    private val prefs: SharedPreferences,
    private val log: (String) -> Unit,
) {
    companion object {
        const val PROJECT_ID = "onetaskonly-app"
        private const val CERTS_URL =
            "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
        private const val KEY_OWNER = "authOwnerUid"
        private const val KEY_TOKENS = "authHostTokens"
        private const val MAX_TOKENS = 10
        private const val CERT_TTL_MS = 12 * 60 * 60 * 1000L
    }

    @Volatile private var cachedCerts: Map<String, PublicKey> = emptyMap()
    @Volatile private var certsFetchedAt = 0L

    fun ownerUid(): String? = prefs.getString(KEY_OWNER, null)

    /** Auth is only enforced once someone has paired. */
    fun isEnforced(): Boolean = ownerUid() != null

    fun resetPairing() {
        prefs.edit().remove(KEY_OWNER).remove(KEY_TOKENS).apply()
        log("[AUTH] Pairing reset — host is open until the next pairing")
    }

    fun isValidHostToken(candidate: String?): Boolean {
        if (candidate.isNullOrBlank()) return false
        val cand = candidate.toByteArray(Charsets.UTF_8)
        for (i in 0 until storedTokens().length()) {
            val t = storedTokens().optString(i) ?: continue
            if (MessageDigest.isEqual(cand, t.toByteArray(Charsets.UTF_8))) return true
        }
        return false
    }

    /** Handle POST /pair. Returns (httpStatus, jsonBody). */
    fun pair(idToken: String): Pair<Int, String> {
        if (idToken.isBlank()) return 400 to ApiJson.error("missing Firebase ID token")
        val uid = try { verifyIdToken(idToken) } catch (ex: Exception) {
            log("[AUTH] pair verify error: ${ex.message}")
            null
        } ?: return 401 to ApiJson.error("invalid or expired sign-in token")

        val owner = ownerUid()
        if (owner == null) {
            prefs.edit().putString(KEY_OWNER, uid).apply()
            log("[AUTH] Host claimed by account $uid (trust-on-first-use)")
        } else if (owner != uid) {
            log("[AUTH] pair rejected — different account than owner")
            return 403 to ApiJson.error(
                "this host is paired to a different account; reset pairing on the host device to switch"
            )
        }

        val token = newToken()
        val tokens = storedTokens().put(token)
        while (tokens.length() > MAX_TOKENS) tokens.remove(0)
        prefs.edit().putString(KEY_TOKENS, tokens.toString()).apply()
        return 200 to JSONObject().put("hostToken", token).put("owner", true).toString()
    }

    private fun storedTokens(): JSONArray =
        try { JSONArray(prefs.getString(KEY_TOKENS, "[]") ?: "[]") } catch (_: Exception) { JSONArray() }

    private fun newToken(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    // ── Firebase ID token verification (no SDK — raw JWT + Google certs) ──

    private fun verifyIdToken(jwt: String): String? {
        val parts = jwt.split('.')
        if (parts.size != 3) return null
        val header = JSONObject(String(b64Url(parts[0]), Charsets.UTF_8))
        val payload = JSONObject(String(b64Url(parts[1]), Charsets.UTF_8))
        if (header.optString("alg") != "RS256") return null

        val now = System.currentTimeMillis() / 1000
        if (payload.optLong("exp") <= now) return null
        if (payload.optString("aud") != PROJECT_ID) return null
        if (payload.optString("iss") != "https://securetoken.google.com/$PROJECT_ID") return null
        val uid = payload.optString("sub")
        if (uid.isBlank()) return null

        val kid = header.optString("kid")
        val key = publicKeyFor(kid) ?: return null
        val sig = Signature.getInstance("SHA256withRSA")
        sig.initVerify(key)
        sig.update("${parts[0]}.${parts[1]}".toByteArray(Charsets.US_ASCII))
        return if (sig.verify(b64Url(parts[2]))) uid else null
    }

    private fun b64Url(s: String): ByteArray =
        Base64.decode(s, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

    private fun publicKeyFor(kid: String): PublicKey? {
        val fresh = System.currentTimeMillis() - certsFetchedAt < CERT_TTL_MS
        cachedCerts[kid]?.let { if (fresh) return it }
        // Miss or stale → refetch (also covers Google's key rotation)
        synchronized(this) {
            if (cachedCerts[kid] == null || System.currentTimeMillis() - certsFetchedAt >= CERT_TTL_MS) {
                fetchCerts()
            }
        }
        return cachedCerts[kid]
    }

    private fun fetchCerts() {
        try {
            val conn = URL(CERTS_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            val json = conn.inputStream.bufferedReader().use { it.readText() }
            val obj = JSONObject(json)
            val cf = CertificateFactory.getInstance("X.509")
            val map = HashMap<String, PublicKey>()
            for (k in obj.keys()) {
                val pem = obj.getString(k)
                    .replace("-----BEGIN CERTIFICATE-----", "")
                    .replace("-----END CERTIFICATE-----", "")
                    .replace("\n", "")
                val der = Base64.decode(pem, Base64.DEFAULT)
                val cert = cf.generateCertificate(ByteArrayInputStream(der)) as X509Certificate
                map[k] = cert.publicKey
            }
            cachedCerts = map
            certsFetchedAt = System.currentTimeMillis()
            log("[AUTH] Google signing certs refreshed (${map.size} keys)")
        } catch (ex: Exception) {
            log("[AUTH] cert fetch failed: ${ex.message}")
        }
    }
}
