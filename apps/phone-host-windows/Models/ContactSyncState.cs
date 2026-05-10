namespace DeskPhone.Models;

public class ContactSyncState
{
    public string RootPath { get; set; } = "";
    public string InboxPath { get; set; } = "";
    public string OutboxPath { get; set; } = "";
    public string PendingOutboundPath { get; set; } = "";
    public int PendingFileCount { get; set; }
    public int ImportedFileCount { get; set; }
    public int IgnoredFileCount { get; set; }
    public int PendingOutboundFileCount { get; set; }
    public int PendingOutboundUpsertCount { get; set; }
    public int PendingOutboundDeleteCount { get; set; }
}
