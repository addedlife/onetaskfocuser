using System.Text;
using DeskPhone.RelayV2.Bt;
using DeskPhone.RelayV2.Obex;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DeskPhone.RelayV2.Tests;

public class MapListingTests
{
    [Fact]
    public void Parses_Inbox_And_Mms_Rows()
    {
        var xml = """
            <?xml version="1.0"?>
            <MAP-msg-listing version="1.0">
              <msg handle="20001" sender_addressing="+15745550001" subject="hey" datetime="20260701T120000-0400" read="no" type="SMS_GSM" direction="incoming"/>
              <msg handle="20002" recipient_addressing="+15745550002" subject="pic" datetime="20260701T130000" read="yes" type="MMS" direction="outgoing"/>
            </MAP-msg-listing>
            """;
        var rows = MapClientV2.ParseListing(Encoding.UTF8.GetBytes(xml), "inbox");

        Assert.Equal(2, rows.Count);
        Assert.Equal("+15745550001", rows[0].Sender);
        Assert.True(rows[0].Incoming);
        Assert.False(rows[0].IsRead);
        Assert.False(rows[0].IsMms);
        // Timezone offset honored — the "+4h skew" class of bug.
        Assert.Equal(new DateTimeOffset(2026, 7, 1, 12, 0, 0, TimeSpan.FromHours(-4)), rows[0].Time);

        Assert.True(rows[1].IsMms);
        Assert.False(rows[1].Incoming); // direction=outgoing
        Assert.Equal("+15745550002", rows[1].Recipient);
    }

    [Fact]
    public void Sent_Folder_Rows_Are_Never_Incoming()
    {
        var xml = """<MAP-msg-listing><msg handle="1" sender_addressing="+1555"/></MAP-msg-listing>""";
        var rows = MapClientV2.ParseListing(Encoding.UTF8.GetBytes(xml), "sent");
        Assert.False(Assert.Single(rows).Incoming);
    }

    [Fact]
    public void Malformed_Xml_Returns_Empty_Not_Throw()
    {
        Assert.Empty(MapClientV2.ParseListing("<msg handle="u8.ToArray(), "inbox"));
    }
}

public class MessageDeltaPlannerTests
{
    private static MapListingEntry Row(string handle) =>
        new(handle, "+1555", "", "", null, false, false, true);

    [Fact]
    public void Fetches_Only_Unknown_Handles_Preserving_Order()
    {
        var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "B" };
        var plan = MessageDeltaPlanner.PlanFetches(known, new[] { Row("A"), Row("B"), Row("C") }, 10);
        Assert.Equal(new[] { "A", "C" }, plan.Select(p => p.Handle));
    }

    [Fact]
    public void Caps_Dedupes_And_Skips_Blank_Handles()
    {
        var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var plan = MessageDeltaPlanner.PlanFetches(known,
            new[] { Row(""), Row("A"), Row("A"), Row("B"), Row("C") }, maxFetch: 2);
        Assert.Equal(new[] { "A", "B" }, plan.Select(p => p.Handle));
    }
}

public class MapSendTests
{
    [Fact]
    public async Task Send_Ladder_Falls_Back_To_Cdma_On_NotAcceptable()
    {
        // Phone rejects SMS_GSM with NotAcceptable (the ONE retryable code),
        // accepts the SMS_CDMA retry.
        var wire = new CapturingFixtureStream(
            new ObexPacket { Code = (byte)ObexResponse.NotAcceptable }.Serialize(),
            new ObexPacket { Code = (byte)ObexResponse.Success }.Serialize());
        var map = new MapClientV2(NullLogger.Instance, new ObexEngine(wire));

        Assert.True(await map.SendMessageAsync("+15745550000", "hello"));

        Assert.Equal(2, wire.Writes.Count);
        Assert.Contains("SMS_GSM", Encoding.ASCII.GetString(wire.Writes[0]));
        Assert.Contains("SMS_CDMA", Encoding.ASCII.GetString(wire.Writes[1]));
    }

    [Fact]
    public async Task Definitive_Failure_Does_Not_Retry()
    {
        var wire = new CapturingFixtureStream(
            new ObexPacket { Code = (byte)ObexResponse.Forbidden }.Serialize());
        var map = new MapClientV2(NullLogger.Instance, new ObexEngine(wire));

        await Assert.ThrowsAsync<ObexProtocolException>(() => map.SendMessageAsync("+15745550000", "hello"));
        Assert.Single(wire.Writes); // no second message type attempted
    }

    // Preloaded response packets; every outbound packet is captured, not written.
    private sealed class CapturingFixtureStream : MemoryStream
    {
        public List<byte[]> Writes { get; } = new();
        public CapturingFixtureStream(params byte[][] packets)
        {
            foreach (var p in packets) base.Write(p, 0, p.Length);
            Position = 0;
        }
        public override void Write(byte[] buffer, int offset, int count) => Writes.Add(buffer.AsSpan(offset, count).ToArray());
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken ct)
        { Writes.Add(buffer.AsSpan(offset, count).ToArray()); return Task.CompletedTask; }
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default)
        { Writes.Add(buffer.ToArray()); return ValueTask.CompletedTask; }
    }
}

// The owner's handset ACCEPTED (0xA0) the first draft's "tidied" envelope and
// then silently never transmitted the SMS — discovered in the first live
// test. These pins hold both builders to the legacy stack's production-proven
// bytes: STATUS:UNREAD, no empty N: line in the recipient vCard, ENCODING:8BIT.
public class BMessageTemplateParityTests
{
    [Fact]
    public void Sms_Envelope_Matches_The_Production_Proven_Template()
    {
        var bmsg = MapClientV2.BuildSmsBMessage("+15745550000", "hi");
        Assert.Contains("STATUS:UNREAD\r\n", bmsg);
        Assert.Contains("CHARSET:UTF-8\r\nENCODING:8BIT\r\n", bmsg);
        Assert.DoesNotContain("\r\nN:", bmsg); // the empty-N: line is the silent-drop trigger
        Assert.Contains("FOLDER:telecom/msg/outbox\r\n", bmsg);
        Assert.Contains($"LENGTH:{Encoding.UTF8.GetByteCount("BEGIN:MSG\r\nhi\r\nEND:MSG\r\n")}\r\n", bmsg);
    }

    [Fact]
    public void Mms_Envelope_Matches_The_Production_Proven_Template()
    {
        var payload = MapClientV2.BuildMmsBMessage("+15551234567", "",
            new[] { new MapAttachment("image/jpeg", "a.jpg", new byte[] { 1 }) });
        var latin = Encoding.Latin1.GetString(payload);
        Assert.Contains("STATUS:UNREAD\r\n", latin);
        Assert.Contains("ENCODING:8BIT\r\n", latin);
        Assert.DoesNotContain("\r\nN:", latin);
    }
}

public class MmsAttachmentTests
{
    [Fact]
    public void Base64_Image_Attachment_Is_Extracted_With_Text()
    {
        var png = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4 };
        var mime =
            "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n" +
            "--b1\r\nContent-Type: text/plain\r\n\r\ncheck this out\r\n" +
            "--b1\r\nContent-Type: image/png; name=\"photo.png\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
            Convert.ToBase64String(png) + "\r\n--b1--\r\n";
        var bmsg =
            "BEGIN:BMSG\r\nVERSION:1.0\r\nTYPE:MMS\r\nBEGIN:BENV\r\nBEGIN:VCARD\r\nTEL:+15745550000\r\nEND:VCARD\r\n" +
            "BEGIN:BBODY\r\nBEGIN:MSG\r\n" + mime + "\r\nEND:MSG\r\nEND:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n";

        var parsed = BMessageParser.Parse(Encoding.UTF8.GetBytes(bmsg));

        Assert.Equal("+15745550000", parsed.Sender);
        Assert.Equal("check this out", parsed.Body);
        var att = Assert.Single(parsed.Attachments);
        Assert.Equal("image/png", att.ContentType);
        Assert.Equal("photo.png", att.FileName);
        Assert.Equal(png, att.Data);
    }

    [Fact]
    public void Smil_Presentation_Part_Is_Not_An_Attachment()
    {
        var mime =
            "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n" +
            "--b1\r\nContent-Type: application/smil\r\n\r\n<smil><body/></smil>\r\n" +
            "--b1\r\nContent-Type: text/plain\r\n\r\nactual text\r\n--b1--\r\n";
        var parsed = BMessageParser.Parse(Encoding.UTF8.GetBytes(mime));
        Assert.Equal("actual text", parsed.Body);
        Assert.Empty(parsed.Attachments);
    }

    [Fact]
    public void Outbound_Mms_RoundTrips_Through_Parser()
    {
        var jpeg = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 9, 9, 9 };
        var payload = MapClientV2.BuildMmsBMessage("+15741112222", "photo attached",
            new[] { new MapAttachment("image/jpeg", "pic.jpg", jpeg) });

        var parsed = BMessageParser.Parse(payload);

        Assert.Equal("+15741112222", parsed.Sender);
        Assert.Equal("photo attached", parsed.Body);
        var att = Assert.Single(parsed.Attachments);
        Assert.Equal("image/jpeg", att.ContentType);
        Assert.Equal(jpeg, att.Data);
    }
}
