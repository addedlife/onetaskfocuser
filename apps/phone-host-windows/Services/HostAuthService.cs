using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace DeskPhone.Services;

/// <summary>
/// One-stop auth for the host control API, riding the owner's existing Google
/// sign-in — the same design as the Android host's HostAuth.kt:
///
///  1. The web app (already signed into Firebase with the owner's Google
///     account) POSTs its Firebase ID token to /pair.
///  2. We verify the RS256 signature against Google's published securetoken
///     certs (cached 12 h) and check iss/aud/exp for our project.
///  3. First valid pairing claims the host (trust-on-first-use); later
///     pairings must present the same uid.
///  4. We mint a random host token the client sends as X-Host-Token.
///     Until a first pairing happens the API stays open (rollout safety).
///
/// Loopback requests are exempt: DeskPhone's own embedded web shell is served
/// from 127.0.0.1 and has no Firebase session of its own.
/// </summary>
public class HostAuthService
{
    public const string ProjectId = "onetaskonly-app";
    private const string CertsUrl =
        "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
    private const int MaxTokens = 10;
    private static readonly TimeSpan CertTtl = TimeSpan.FromHours(12);

    private readonly string _statePath;
    private readonly object _lock = new();
    private readonly Action<string>? _log;

    private string? _ownerUid;
    private List<string> _tokens = new();

    private Dictionary<string, RSA> _certs = new();
    private DateTime _certsFetchedAt = DateTime.MinValue;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(8) };

    public HostAuthService(Action<string>? log = null)
    {
        _log = log;
        _statePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "DeskPhone", "hostauth.json");
        Load();
    }

    public bool IsEnforced { get { lock (_lock) return _ownerUid is not null; } }

    public void ResetPairing()
    {
        lock (_lock) { _ownerUid = null; _tokens.Clear(); Save(); }
        _log?.Invoke("[AUTH] Pairing reset — host is open until the next pairing");
    }

    public bool IsValidHostToken(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return false;
        var cand = Encoding.UTF8.GetBytes(candidate);
        lock (_lock)
        {
            return _tokens.Any(t =>
                CryptographicOperations.FixedTimeEquals(cand, Encoding.UTF8.GetBytes(t)));
        }
    }

    /// <summary>Handle POST /pair. Returns (httpStatus, jsonBody).</summary>
    public (int Status, string Body) Pair(string? idToken)
    {
        if (string.IsNullOrWhiteSpace(idToken))
            return (400, Error("missing Firebase ID token"));

        string? uid;
        try { uid = VerifyIdToken(idToken); }
        catch (Exception ex) { _log?.Invoke($"[AUTH] pair verify error: {ex.Message}"); uid = null; }
        if (uid is null)
            return (401, Error("invalid or expired sign-in token"));

        lock (_lock)
        {
            if (_ownerUid is null)
            {
                _ownerUid = uid;
                _log?.Invoke($"[AUTH] Host claimed by account {uid} (trust-on-first-use)");
            }
            else if (_ownerUid != uid)
            {
                _log?.Invoke("[AUTH] pair rejected — different account than owner");
                return (403, Error(
                    "this host is paired to a different account; reset pairing on the host device to switch"));
            }

            var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            _tokens.Add(token);
            while (_tokens.Count > MaxTokens) _tokens.RemoveAt(0);
            Save();
            return (200, JsonSerializer.Serialize(new { hostToken = token, owner = true }));
        }
    }

    private static string Error(string message) =>
        JsonSerializer.Serialize(new { error = message });

    // ── State persistence ─────────────────────────────────────────────────

    private void Load()
    {
        try
        {
            if (!File.Exists(_statePath)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(_statePath));
            _ownerUid = doc.RootElement.TryGetProperty("ownerUid", out var o) ? o.GetString() : null;
            if (doc.RootElement.TryGetProperty("tokens", out var t) && t.ValueKind == JsonValueKind.Array)
                _tokens = t.EnumerateArray().Select(e => e.GetString() ?? "")
                    .Where(s => s.Length > 0).ToList();
        }
        catch (Exception ex) { _log?.Invoke($"[AUTH] state load failed: {ex.Message}"); }
    }

    private void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_statePath)!);
            var tmp = _statePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(new { ownerUid = _ownerUid, tokens = _tokens }));
            File.Move(tmp, _statePath, overwrite: true);
        }
        catch (Exception ex) { _log?.Invoke($"[AUTH] state save failed: {ex.Message}"); }
    }

    // ── Firebase ID token verification (raw JWT + Google certs) ──────────

    private string? VerifyIdToken(string jwt)
    {
        var parts = jwt.Split('.');
        if (parts.Length != 3) return null;

        using var header = JsonDocument.Parse(B64Url(parts[0]));
        using var payload = JsonDocument.Parse(B64Url(parts[1]));
        if (header.RootElement.GetProperty("alg").GetString() != "RS256") return null;

        var root = payload.RootElement;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (!root.TryGetProperty("exp", out var exp) || exp.GetInt64() <= now) return null;
        if (root.GetProperty("aud").GetString() != ProjectId) return null;
        if (root.GetProperty("iss").GetString() != $"https://securetoken.google.com/{ProjectId}") return null;
        var uid = root.GetProperty("sub").GetString();
        if (string.IsNullOrEmpty(uid)) return null;

        var kid = header.RootElement.GetProperty("kid").GetString() ?? "";
        var key = PublicKeyFor(kid);
        if (key is null) return null;

        var signed = Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}");
        return key.VerifyData(signed, B64Url(parts[2]),
            HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1) ? uid : null;
    }

    private static byte[] B64Url(string s)
    {
        var p = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(p.PadRight(p.Length + (4 - p.Length % 4) % 4, '='));
    }

    private RSA? PublicKeyFor(string kid)
    {
        lock (_lock)
        {
            var fresh = DateTime.UtcNow - _certsFetchedAt < CertTtl;
            if (fresh && _certs.TryGetValue(kid, out var cached)) return cached;
        }
        FetchCerts(); // miss or stale → refetch (covers Google's key rotation)
        lock (_lock) return _certs.TryGetValue(kid, out var key) ? key : null;
    }

    private void FetchCerts()
    {
        try
        {
            var json = Http.GetStringAsync(CertsUrl).GetAwaiter().GetResult();
            using var doc = JsonDocument.Parse(json);
            var map = new Dictionary<string, RSA>();
            foreach (var prop in doc.RootElement.EnumerateObject())
            {
                var pem = prop.Value.GetString() ?? "";
                var cert = X509Certificate2.CreateFromPem(pem);
                var rsa = cert.GetRSAPublicKey();
                if (rsa is not null) map[prop.Name] = rsa;
            }
            lock (_lock)
            {
                _certs = map;
                _certsFetchedAt = DateTime.UtcNow;
            }
            _log?.Invoke($"[AUTH] Google signing certs refreshed ({map.Count} keys)");
        }
        catch (Exception ex) { _log?.Invoke($"[AUTH] cert fetch failed: {ex.Message}"); }
    }
}
