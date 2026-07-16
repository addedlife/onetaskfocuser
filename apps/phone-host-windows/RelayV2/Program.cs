using DeskPhone.RelayV2;
using DeskPhone.RelayV2.Bt;
using DeskPhone.RelayV2.Relay;
using Microsoft.Extensions.Http.Resilience;

// Phone-relay v2 host — Kestrel minimal API on 127.0.0.1:8766 (loopback ONLY
// during the tester phase: zero LAN exposure until the rewire step adds the
// pairing/token layer). Runs beside the live DeskPhone.exe (port 8765)
// without touching it.
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://127.0.0.1:8766");

// Configuration sources: environment variables (RELAYV2_PHONE_BT_ADDRESS,
// PHONE_RELAY_V2_SECRET_WINDOWS, RELAYV2_ENDPOINT, RELAYV2_FORCE_LEADER)
// or appsettings.json.
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
    // Missing secret is NOT fatal: PhoneHostService catches the relay's
    // startup failure and runs local-only, so bench testing needs no cloud.
    var secret = config["PHONE_RELAY_V2_SECRET_WINDOWS"] ?? "";
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
// Attachment BYTES stay out of the list payload — the media endpoint serves
// them individually, exactly like every mail/messaging API does it.
app.MapGet("/messages", (int? limit) => Results.Json(state.Messages.Take(limit ?? 150).Select(m => new
{
    m.Handle,
    m.Sender,
    m.Recipient,
    m.Body,
    time = m.Time?.ToUnixTimeMilliseconds(),
    m.IsRead,
    m.Incoming,
    m.IsMms,
    m.Folder,
    attachments = m.Attachments.Select((a, i) => new { index = i, a.ContentType, a.FileName, size = a.Data.Length }),
})));
app.MapGet("/media/{handle}/{index:int}", (string handle, int index) =>
{
    var msg = state.FindMessage(handle);
    if (msg == null || index < 0 || index >= msg.Attachments.Count) return Results.NotFound();
    var att = msg.Attachments[index];
    return Results.File(att.Data, att.ContentType, att.FileName);
});
app.MapGet("/calls", () => Results.Json(state.Calls));
app.MapGet("/contacts", () => Results.Json(state.Contacts.Select(c => new { name = c.Name, numbers = c.Numbers })));

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
app.MapPost("/toggle-mute", () => Exec("/toggle-mute"));
app.MapPost("/send", (string to, string body) => Exec($"/send?to={Uri.EscapeDataString(to)}&body={Uri.EscapeDataString(body)}"));
app.MapPost("/delete-message", (string handle) => Exec($"/delete-message?handle={Uri.EscapeDataString(handle)}"));
app.MapPost("/mark-conversation-read", (string cid) => Exec($"/mark-conversation-read?cid={Uri.EscapeDataString(cid)}"));
app.MapPost("/mark-conversation-unread", (string cid) => Exec($"/mark-conversation-unread?cid={Uri.EscapeDataString(cid)}"));
app.MapPost("/refresh", () => Exec("/refresh"));
app.MapPost("/connect", () => Exec("/connect"));

// MMS with attachments carries binary payloads — a JSON body, not a query
// string. Attachment data arrives base64-encoded.
app.MapPost("/send-with-attachments", async (SendWithAttachmentsRequest req) =>
{
    var attachments = (req.Attachments ?? new List<AttachmentDto>())
        .Select(a => new MapAttachment(
            string.IsNullOrWhiteSpace(a.ContentType) ? "application/octet-stream" : a.ContentType,
            string.IsNullOrWhiteSpace(a.FileName) ? "attachment.bin" : a.FileName,
            Convert.FromBase64String(a.DataBase64)))
        .ToList();
    var ok = await host.SendUserMessageAsync(req.To, req.Body ?? "", attachments);
    return Results.Ok(new { ok });
});

app.Run();

internal sealed record AttachmentDto(string ContentType, string FileName, string DataBase64);
internal sealed record SendWithAttachmentsRequest(string To, string? Body, List<AttachmentDto>? Attachments);
