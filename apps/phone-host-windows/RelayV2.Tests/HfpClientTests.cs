using System.Text;
using DeskPhone.RelayV2.Hfp;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace DeskPhone.RelayV2.Tests;

public class HfpClientTests
{
    // Regression: the phone sends a URC (+CIEV call=1) in the SAME byte burst
    // as the final handshake OK. The original draft used one buffered reader
    // for the handshake and a second for the read loop; the first reader's
    // read-ahead swallowed everything behind the last OK, so that URC was
    // lost forever. One shared reader must deliver it to the state machine.
    [Fact]
    public async Task Urc_Behind_Final_Handshake_Ok_Is_Not_Lost()
    {
        var wire = string.Join("\r\n",
            "+BRSF: 871", "OK",                                                        // AT+BRSF
            "+CIND: (\"service\",(0,1)),(\"call\",(0,1)),(\"callsetup\",(0-3))", "OK", // AT+CIND=?
            "+CIND: 1,0,0", "OK",                                                      // AT+CIND?
            "OK",                                                                      // AT+CMER
            "OK",                                                                      // AT+CLIP
            "OK",                                                                      // AT+CCWA
            "+CIEV: 2,1",                                                              // call active — right behind the OK
            "");
        using var stream = new DuplexFixture(wire);
        var hfp = new HfpClientV2(NullLogger.Instance);
        var seen = new List<CallState>();
        hfp.Calls.StateChanged += s => seen.Add(s.State);
        var disconnected = new TaskCompletionSource();
        hfp.Disconnected += () => disconnected.TrySetResult();

        await hfp.AttachAsync(stream, CancellationToken.None);
        await disconnected.Task.WaitAsync(TimeSpan.FromSeconds(5)); // fixture EOF ends the loop
        await hfp.DisposeAsync();

        Assert.Contains(CallState.Active, seen);
    }

    // A handset that rejects call waiting must still complete the handshake —
    // CCWA is an optional nicety, not a load-bearing part of the SLC.
    [Fact]
    public async Task Ccwa_Error_Does_Not_Fail_Handshake()
    {
        var wire = string.Join("\r\n",
            "+BRSF: 871", "OK",
            "+CIND: (\"service\",(0,1)),(\"call\",(0,1)),(\"callsetup\",(0-3))", "OK",
            "+CIND: 1,0,0", "OK",
            "OK",      // AT+CMER
            "OK",      // AT+CLIP
            "ERROR",   // AT+CCWA rejected
            "");
        using var stream = new DuplexFixture(wire);
        var hfp = new HfpClientV2(NullLogger.Instance);
        var disconnected = new TaskCompletionSource();
        hfp.Disconnected += () => disconnected.TrySetResult();

        // Completing without an exception IS the assertion — a rejected CCWA
        // used to abort the handshake. (IsConnected can't be asserted here:
        // the fixture EOFs immediately, so the read loop may already have
        // torn down by the time this line runs.)
        await hfp.AttachAsync(stream, CancellationToken.None);
        await disconnected.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await hfp.DisposeAsync();
    }

    // Preloaded incoming bytes; every outbound write is swallowed.
    private sealed class DuplexFixture : MemoryStream
    {
        public DuplexFixture(string incoming)
        {
            var bytes = Encoding.ASCII.GetBytes(incoming);
            base.Write(bytes, 0, bytes.Length);
            Position = 0;
        }
        public override void Write(byte[] buffer, int offset, int count) { }
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken ct) => Task.CompletedTask;
        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default) => ValueTask.CompletedTask;
    }
}
