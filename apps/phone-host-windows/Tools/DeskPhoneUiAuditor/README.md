# DeskPhone UI Auditor

This is DeskPhone's product-specific UI audit tool. It has a small Windows interface for manual runs and a command-line mode for release checks. It complements off-the-shelf tools such as Microsoft Accessibility Insights for Windows by checking issues that matter to this app's layout and release quality.

## Run

Open `DeskPhoneUiAuditor.exe` from a deployed build, or use the Open Auditor button in DeskPhone Settings.

From the DeskPhone repo root:

```powershell
dotnet run --project .\Tools\DeskPhoneUiAuditor\DeskPhoneUiAuditor.csproj -c Release
```

For command-line audit mode:

```powershell
dotnet run --project .\Tools\DeskPhoneUiAuditor\DeskPhoneUiAuditor.csproj -c Release -- --start-latest
```

Outputs are written under:

```text
artifacts\ui-audits\<timestamp>\
```

Each run writes:

- `summary.md`: short review report.
- `audit.json`: machine-readable details for future automation.
- `deskphone.png`: screenshot of the audited window when capture succeeds.

## Checks

- Finds the running DeskPhone window, or starts the latest deployed build with `--start-latest`.
- Captures DPI, screenshot, and UI Automation tree data.
- Flags missing accessible names on actionable controls.
- Flags small click targets.
- Flags overlapping actionable controls.
- Flags likely clipped text.
- Flags WPF blur risks such as whole-window transforms, effects, fractional layout values, and missing text-rendering defaults.

## Strict Mode

Use `--strict` in automation if medium or high findings should fail the run:

```powershell
dotnet run --project .\Tools\DeskPhoneUiAuditor\DeskPhoneUiAuditor.csproj -c Release -- --start-latest --strict
```
