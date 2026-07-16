using System.Text;
using DeskPhone.RelayV2.Obex;
using Microsoft.Extensions.Logging;

namespace DeskPhone.RelayV2.Bt;

// PBAP client — contacts + call history over one ObexEngine session.
// Session-per-pull (connect, download, disconnect) like the legacy service,
// but all OBEX framing lives in ObexEngine and all vCard parsing in
// VCardParser; this class is only orchestration.
public sealed class PbapClientV2
{
    private static readonly byte[] PbapTarget =
    {
        0x79, 0x61, 0x35, 0xF0, 0xF0, 0xC5, 0x11, 0xD8,
        0x09, 0x66, 0x08, 0x00, 0x20, 0x0C, 0x9A, 0x66,
    };
    private const string VCardListingType = "x-bt/phonebook";

    private readonly ILogger _log;
    public PbapClientV2(ILogger log) => _log = log;

    public sealed record PhonePull(
        List<VCardEntry> Contacts,
        List<VCardEntry> IncomingCalls,
        List<VCardEntry> OutgoingCalls,
        List<VCardEntry> MissedCalls);

    public async Task<PhonePull> PullAllAsync(ulong bluetoothAddress, CancellationToken ct = default)
    {
        await using var conn = await RfcommConnection.ConnectAsync(bluetoothAddress, RfcommConnection.PbapUuid, ct);
        var obex = new ObexEngine(conn.Stream);

        // Targeted CONNECT first; bare fallback for handsets that reject the
        // PBAP target header (both observed in production on the legacy stack).
        var code = await obex.ConnectAsync(PbapTarget, ct);
        if (code != ObexResponse.Success)
        {
            _log.LogInformation("PBAP targeted CONNECT -> {Code}; retrying bare", code);
            code = await obex.ConnectAsync(null, ct);
            if (code != ObexResponse.Success)
                throw new ObexProtocolException($"PBAP CONNECT failed: {code}");
        }

        var contacts = await PullBookAsync(obex, "telecom/pb.vcf", ct);
        var incoming = await PullBookAsync(obex, "telecom/ich.vcf", ct);
        var outgoing = await PullBookAsync(obex, "telecom/och.vcf", ct);
        var missed   = await PullBookAsync(obex, "telecom/mch.vcf", ct);

        await obex.DisconnectAsync(ct);
        return new PhonePull(contacts, incoming, outgoing, missed);
    }

    private async Task<List<VCardEntry>> PullBookAsync(ObexEngine obex, string path, CancellationToken ct)
    {
        // MaxListCount app-param (id 0x04, 2 bytes): request everything.
        var appParams = new byte[] { 0x04, 0x02, 0xFF, 0xFF };
        var result = await obex.GetAsync(path, VCardListingType, appParams, ct);
        if (result.Code != ObexResponse.Success)
        {
            // A missing book (e.g. empty missed-call log on some handsets
            // returns NotFound) is data, not an error.
            _log.LogInformation("PBAP GET {Path} -> {Code}", path, result.Code);
            return new List<VCardEntry>();
        }
        return VCardParser.Parse(result.Body);
    }
}
