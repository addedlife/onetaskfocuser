using System.Text;
using DeskPhone.RelayV2.Bt;
using DeskPhone.RelayV2.Hfp;
using DeskPhone.RelayV2.Obex;
using Xunit;

namespace DeskPhone.RelayV2.Tests;

public class ObexPacketTests
{
    [Fact]
    public void RoundTrips_Headers()
    {
        var p = new ObexPacket { Code = (byte)ObexOpcode.GetFinal };
        p.AddUnicode(ObexHeaderId.Name, "telecom/pb.vcf");
        p.AddByteSeq(ObexHeaderId.Type, Encoding.ASCII.GetBytes("x-bt/phonebook\0"));
        p.AddFourByte(ObexHeaderId.ConnectionId, 0xDEADBEEF);

        var parsed = ObexPacket.Parse(p.Serialize());
        Assert.Equal((byte)ObexOpcode.GetFinal, parsed.Code);
        Assert.Equal("telecom/pb.vcf", Encoding.BigEndianUnicode.GetString(parsed.FindHeader(ObexHeaderId.Name)!).TrimEnd('\0'));
        Assert.Equal(0xDEADBEEF, System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(parsed.FindHeader(ObexHeaderId.ConnectionId)!));
    }

    [Fact]
    public void Rejects_DeclaredLength_Mismatch()
    {
        var bytes = new ObexPacket { Code = (byte)ObexResponse.Success }.Serialize();
        bytes[2] += 5; // corrupt the declared length
        Assert.Throws<ObexProtocolException>(() => ObexPacket.Parse(bytes));
    }

    [Fact]
    public void Rejects_HeaderLength_ExceedingPacket()
    {
        // Hostile header claiming to extend past the packet end — the
        // untrusted-length bug class found in the legacy Android MNS server.
        var raw = new byte[] { 0xA0, 0x00, 0x06, 0x42, 0xFF, 0xFF };
        Assert.Throws<ObexProtocolException>(() => ObexPacket.Parse(raw));
    }

    [Fact]
    public void Tolerates_MediaTek_ShortConnect()
    {
        // CONNECT response missing the 4 version/flags/maxPacket bytes.
        var raw = new byte[] { 0xA0, 0x00, 0x03 };
        var parsed = ObexPacket.Parse(raw, fixedFieldCount: 4, tolerateShortConnect: true);
        Assert.Equal(ObexResponse.Success, parsed.ResponseCode);
        Assert.Empty(parsed.FixedFields);
    }
}

public class ObexEngineTests
{
    [Fact]
    public async Task Get_Reassembles_MultiPacket_Continue()
    {
        // Fixture: server replies Continue with body "AB", then Success with
        // end-of-body "CD" — client must reassemble "ABCD".
        var cont = new ObexPacket { Code = (byte)ObexResponse.Continue };
        cont.AddByteSeq(ObexHeaderId.Body, "AB"u8.ToArray());
        var done = new ObexPacket { Code = (byte)ObexResponse.Success };
        done.AddByteSeq(ObexHeaderId.EndOfBody, "CD"u8.ToArray());

        var wire = new FixtureStream(cont.Serialize(), done.Serialize());
        var engine = new ObexEngine(wire);
        var result = await engine.GetAsync("x", "y");
        Assert.Equal(ObexResponse.Success, result.Code);
        Assert.Equal("ABCD", Encoding.ASCII.GetString(result.Body));
    }

    [Fact]
    public async Task Server_Reassembles_MultiPacket_Put()
    {
        var put1 = new ObexPacket { Code = (byte)ObexOpcode.Put };
        put1.AddByteSeq(ObexHeaderId.Body, "hello "u8.ToArray());
        var put2 = new ObexPacket { Code = (byte)ObexOpcode.PutFinal };
        put2.AddByteSeq(ObexHeaderId.EndOfBody, "world"u8.ToArray());
        var disconnect = new ObexPacket { Code = (byte)ObexOpcode.Disconnect };

        var wire = new FixtureStream(put1.Serialize(), put2.Serialize(), disconnect.Serialize());
        var engine = new ObexEngine(wire);
        string? received = null;
        await engine.ServeAsync(payload => { received = Encoding.ASCII.GetString(payload); return Task.CompletedTask; });
        Assert.Equal("hello world", received);
    }

    // Feeds queued packets as reads; swallows writes.
    private sealed class FixtureStream : MemoryStream
    {
        public FixtureStream(params byte[][] packets)
        {
            foreach (var p in packets) base.Write(p, 0, p.Length); // base: bypass the swallow override
            Position = 0;
        }
        public override void Write(byte[] buffer, int offset, int count) { /* swallow engine writes */ }
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default) => ValueTask.CompletedTask;
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken ct) => Task.CompletedTask;
    }
}

public class AtTokenizerTests
{
    [Fact]
    public void Clip_With_Comma_In_QuotedName_DoesNotSplit()
    {
        var t = new AtTokenizer();
        // The exact case the legacy split(',') corrupted.
        var evt = t.Tokenize("+CLIP: \"+15745551234\",145,\"Smith, John\"");
        var clip = Assert.IsType<AtEvent.CallerId>(evt);
        Assert.Equal("+15745551234", clip.Number);
    }

    [Fact]
    public void Ciev_Resolves_Indicator_Names_From_Cind()
    {
        var t = new AtTokenizer();
        t.LoadCindDefinition("(\"service\",(0,1)),(\"call\",(0,1)),(\"callsetup\",(0-3))");
        var evt = t.Tokenize("+CIEV: 2,1");
        var ciev = Assert.IsType<AtEvent.IndicatorChange>(evt);
        Assert.Equal("call", ciev.Name);
        Assert.Equal(1, ciev.Value);
    }

    [Fact]
    public void Unknown_Urc_Never_Throws()
    {
        var t = new AtTokenizer();
        Assert.IsType<AtEvent.Unknown>(t.Tokenize("+XWEIRD: 1,2,3"));
    }
}

public class CallStateMachineTests
{
    private static (CallStateMachine, Func<TimeSpan, DateTimeOffset>) MachineWithClock()
    {
        var now = DateTimeOffset.UnixEpoch;
        var machine = new CallStateMachine(() => now);
        return (machine, advance => now += advance);
    }

    [Fact]
    public void Missed_Call_Resolves_After_Holdoff()
    {
        var (m, advance) = MachineWithClock();
        var outcomes = new List<CallOutcome>();
        m.CallResolved += (o, _) => outcomes.Add(o);

        m.Handle(new AtEvent.Ring());
        m.Handle(new AtEvent.CallerId("5551234"));
        m.Handle(new AtEvent.IndicatorChange(HfpIndicators.CallSetup, 0)); // ambiguous
        m.Tick();
        Assert.Empty(outcomes); // still inside the holdoff — no verdict yet

        advance(CallStateMachine.RingResolutionHoldoff + TimeSpan.FromMilliseconds(1));
        m.Tick();
        Assert.Equal(new[] { CallOutcome.Missed }, outcomes);
        Assert.Equal(CallState.Idle, m.Snapshot().State);
    }

    [Fact]
    public void Answered_Call_Wins_The_Ambiguity()
    {
        var (m, _) = MachineWithClock();
        var outcomes = new List<CallOutcome>();
        m.CallResolved += (o, _) => outcomes.Add(o);

        m.Handle(new AtEvent.Ring());
        m.Handle(new AtEvent.IndicatorChange(HfpIndicators.CallSetup, 0)); // ambiguous
        m.Handle(new AtEvent.IndicatorChange(HfpIndicators.Call, 1));      // answered!
        Assert.Equal(new[] { CallOutcome.Answered }, outcomes);
        Assert.Equal(CallState.Active, m.Snapshot().State);

        m.Handle(new AtEvent.IndicatorChange(HfpIndicators.Call, 0));
        Assert.Equal(CallOutcome.Ended, outcomes[^1]);
        Assert.Equal(CallState.Idle, m.Snapshot().State);
    }
}

public class VCardParserTests
{
    [Fact]
    public void Parses_QuotedPrintable_Name()
    {
        var card = "BEGIN:VCARD\r\nVERSION:2.1\r\nN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:=D7=A9=D7=9E=D7=95=D7=90=D7=9C;\r\nTEL:+15740001111\r\nEND:VCARD\r\n";
        var entries = VCardParser.Parse(Encoding.UTF8.GetBytes(card));
        Assert.Single(entries);
        Assert.Equal("שמואל", entries[0].Name);
        Assert.Equal("+15740001111", entries[0].Numbers[0]);
    }

    [Fact]
    public void CallTime_With_Offset_Is_Honored()
    {
        // The "+4h skew" regression fixture: offset must not be dropped.
        var card = "BEGIN:VCARD\r\nVERSION:2.1\r\nTEL:555\r\nX-IRMC-CALL-DATETIME;MISSED:20260701T120000-0400\r\nEND:VCARD\r\n";
        var entries = VCardParser.Parse(Encoding.UTF8.GetBytes(card));
        Assert.Equal(new DateTimeOffset(2026, 7, 1, 12, 0, 0, TimeSpan.FromHours(-4)), entries[0].CallTime);
        Assert.Equal("MISSED", entries[0].CallDirection);
    }

    [Fact]
    public void Garbage_Timestamp_Yields_Null_Not_Now()
    {
        var card = "BEGIN:VCARD\r\nTEL:555\r\nX-IRMC-CALL-DATETIME:not-a-date\r\nEND:VCARD\r\n";
        Assert.Null(VCardParser.Parse(Encoding.UTF8.GetBytes(card))[0].CallTime);
    }
}

public class BMessageParserTests
{
    [Fact]
    public void Standard_Envelope()
    {
        var bmsg = "BEGIN:BMSG\r\nVERSION:1.0\r\nBEGIN:BENV\r\nBEGIN:VCARD\r\nTEL:+15745550000\r\nEND:VCARD\r\n" +
                   "BEGIN:BBODY\r\nBEGIN:MSG\r\nhello there\r\nEND:MSG\r\nEND:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n";
        var parsed = BMessageParser.Parse(Encoding.UTF8.GetBytes(bmsg));
        Assert.Equal("+15745550000", parsed.Sender);
        Assert.Equal("hello there", parsed.Body);
    }

    [Fact]
    public void Raw_Mime_Without_Envelope()
    {
        // The MediaTek/"Fig 52" fixture shape.
        var mime = "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"b1\"\r\n\r\n" +
                   "--b1\r\nContent-Type: text/plain\r\n\r\nmms text body\r\n--b1--\r\n";
        Assert.Equal("mms text body", BMessageParser.Parse(Encoding.UTF8.GetBytes(mime)).Body);
    }

    [Fact]
    public void Plain_Text_Fallback()
    {
        Assert.Equal("just text", BMessageParser.Parse("just text"u8.ToArray()).Body);
    }

    [Fact]
    public void Outbound_Sms_BMessage_RoundTrips_Through_Parser()
    {
        var built = MapClientV2.BuildSmsBMessage("+15741112222", "see you at 6");
        var parsed = BMessageParser.Parse(Encoding.UTF8.GetBytes(built));
        Assert.Equal("+15741112222", parsed.Sender);
        Assert.Equal("see you at 6", parsed.Body);
    }
}
