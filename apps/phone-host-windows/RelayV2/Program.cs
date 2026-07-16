using DeskPhone.RelayV2;
using DeskPhone.RelayV2.Relay;
using Microsoft.Extensions.Http.Resilience;

// Phone-relay v2 host — Kestrel minimal API on 127.0.0.1:8766 (loopback ONLY
// during the tester phase: zero LAN exposure until the rewire step adds the
// pairing/token layer). Runs beside the live DeskPhone.exe (port 8765)
// without touching it.
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:8766");

// Configuration sources: environment variables (RELAYV2_PHONE_BT_ADDRESS,
// PHONE_RELAY_V2_SECRET_WINDOWS, RELAYV2_ENDPOINT) or appsettings.json.
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddSingleton<HostState>();
// Microsoft's standard resilience pipeline (rate limiter, total timeout,
// retry, circuit breaker) on the one HttpClient the relay uses — replaces
// every hand-rolled retry loop in the legacy RelayService.
builder.Services.AddHttpClient("relay").AddStandardResilienceHandler();
builder.Services.AddSingleton<RelayClientV2>(sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var http = sp.GetRequiredService<IHttpClientFactory>().CreateClient("relay");
    var endpoint = config["RELAYV2_ENDPOINT"] ?? "https://us-central1-onetaskonly-app.cloudfunctions.net/phoneRelayV2";
    var secret = config["PHONE_RELAY_V2_SECRET_WINDOWS"]
        ?? throw new InvalidOperationException("PHONE_RELAY_V2_SECRET_WINDOWS not configured");
    return new RelayClientV2(sp.GetRequiredService<ILogger<RelayClientV2>>(), http, endpoint, secret);
});
builder.Services.AddSingleton<PhoneHostService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<PhoneHostService>());

var app = builder.Build();
var state = app.Services.GetRequiredService<HostState>();
var host = app.Services.GetRequiredService<PhoneHostService>();
var relay = app.Services.GetRequiredService<RelayClientV2>();

// ── Read endpoints ───────────────────────────────────────────────────────────
app.MapGet("/health", () => Results.Ok(new { ok = true, host = "windows-relayv2" }));
app.MapGet("/status", () => Results.Json(state.StatusPayload()));
app.MapGet("/relay-status", () => Results.Json(new
{
    leader = relay.CurrentLeader,
    iAmLeader = relay.IAmLeader,
}));
app.MapGet("/log", (int? n) => Results.Json(state.LogTail(n ?? 50)));
app.MapGet("/messages", (int? limit) => Results.Json(state.Messages.Take(limit ?? 150)));
app.MapGet("/calls", () => Results.Json(state.Calls));
app.MapGet("/contacts", () => Results.Json(state.Contacts));

// ── Actions — the SAME executor the cloud command path uses, so local and
// remote control can never drift apart in behavior. ─────────────────────────
async Task<IResult> Exec(string path)
{
    await host.ExecuteCommandAsync(path);
    return Results.Ok(new { ok = true });
}
app.MapPost("/dial", (string n) => Exec($"/dial?n={Uri.EscapeDataString(n)}"));
app.MapPost("/answer", () => Exec("/answer"));
app.MapPost("/hangup", () => Exec("/hangup"));
app.MapPost("/send", (string to, string body) => Exec($"/send?to={Uri.EscapeDataString(to)}&body={Uri.EscapeDataString(body)}"));
app.MapPost("/refresh", () => Exec("/refresh"));
app.MapPost("/connect", () => Exec("/connect"));

app.Run();
