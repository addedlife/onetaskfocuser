# DeskPhone Exact Parity Inventory

Generated: 2026-05-04T03:51:25.031Z

Source root: `C:\Users\ydanz\OneDrive\Documents\PC as Bluetooth call - text interface\DeskPhone`

## Gate

No further DeskPhone Web clone work should proceed from visual guesswork. Each native DeskPhone item must be mapped to one of these states before implementation:

- `implemented-web`: copied into the web page with matching behavior or a documented browser equivalent.
- `host-api-needed`: visible in web, but blocked until the Windows host exposes a command.
- `native-only`: intentionally kept in native DeskPhone with a reason.
- `not-yet-reviewed`: not allowed to drive implementation yet.

## Counts

| Area | Count |
| --- | ---: |
| Source files scanned | 57 |
| XAML files scanned | 17 |
| C# files scanned | 40 |
| XAML UI/style/layout elements | 2013 |
| Action elements: buttons, menu items, toggles, hyperlinks | 199 |
| Layout/frame elements | 428 |
| Style/template elements | 1097 |
| Elements with bindings | 360 |
| Command declarations and wiring entries | 135 |
| C# methods/functions | 506 |
| C# types | 84 |
| Host API endpoints | 19 |

## Files Written

- `docs/deskphone-parity/deskphone-static-inventory.json`: full static ledger.
- `docs/deskphone-parity/deskphone-ui-elements.csv`: spreadsheet-friendly UI element list.
- `docs/deskphone-parity/deskphone-web-parity-map.csv`: action-by-action web parity review queue.
- `docs/deskphone-parity/DESKPHONE_EXACT_PARITY_INVENTORY.md`: this executive summary.

## XAML Element Counts By File

| File | Total | Actions | Layout | Styles |
| --- | ---: | ---: | ---: | ---: |
| App.xaml | 171 | 1 | 21 | 143 |
| LogWindow.xaml | 10 | 1 | 6 | 0 |
| MainWindow.xaml | 1296 | 194 | 335 | 505 |
| Themes/Colors.xaml | 1 | 0 | 0 | 0 |
| Themes/Dark.xaml | 1 | 0 | 0 | 0 |
| Themes/Midnight.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/Arctic.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/Aurora.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/BlueGold.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/Claude.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/Google.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/Nebula.xaml | 1 | 0 | 0 | 0 |
| Themes/Palettes/StarryNight.xaml | 1 | 0 | 0 | 0 |
| Themes/Skins/Apple.xaml | 142 | 1 | 17 | 122 |
| Themes/Skins/Material.xaml | 166 | 1 | 24 | 138 |
| Themes/Skins/Optimus.xaml | 151 | 1 | 17 | 131 |
| Themes/Styles.xaml | 67 | 0 | 8 | 58 |

## Host API Endpoints

| File:line | Method | Path |
| --- | --- | --- |
| Services/ControlApiService.cs:133 | GET/implicit | `/log` |
| Services/ControlApiService.cs:141 | GET/implicit | `/messages` |
| Services/ControlApiService.cs:145 | GET/implicit | `/calls` |
| Services/ControlApiService.cs:149 | GET/implicit | `/contacts` |
| Services/ControlApiService.cs:153 | POST | `/connect` |
| Services/ControlApiService.cs:158 | POST | `/answer` |
| Services/ControlApiService.cs:163 | POST | `/hangup` |
| Services/ControlApiService.cs:168 | POST | `/refresh` |
| Services/ControlApiService.cs:173 | POST | `/shutdown` |
| Services/ControlApiService.cs:184 | POST | `/offer-update` |
| Services/ControlApiService.cs:191 | POST | `/show` |
| Services/ControlApiService.cs:196 | POST | `/handoff` |
| Services/ControlApiService.cs:211 | POST | `/stage` |
| Services/ControlApiService.cs:227 | POST | `/stage-pulse` |
| Services/ControlApiService.cs:233 | POST | `/stage-exit` |
| Services/ControlApiService.cs:240 | POST | `/theme` |
| Services/ControlApiService.cs:247 | POST | `/test-reg` |
| Services/ControlApiService.cs:253 | POST | `/dial` |
| Services/ControlApiService.cs:263 | POST | `/send` |

## First 160 Action Elements

This is a preview only. The JSON file contains the full list.

| File:line | Tag | Label/key | Command binding | Tooltip |
| --- | --- | --- | --- | --- |
| LogWindow.xaml:45 | Button | Clear |  |  |
| MainWindow.xaml:442 | Button | {Binding NavigationRailToggleGlyph} | {Binding ToggleNavigationRailCommand} | {Binding NavigationRailToggleLabel} |
| MainWindow.xaml:455 | Button | &#xE3C9; | New Message |  | New message |
| MainWindow.xaml:508 | RadioButton | &#xE0CA; | Phone |  | Phone: messages and calls |
| MainWindow.xaml:525 | Button | &#xE0B0; | Make Call |  | Make a call |
| MainWindow.xaml:544 | RadioButton | &#xE0B0; | Calls |  | Calls |
| MainWindow.xaml:562 | RadioButton | &#xE7FD; | Contacts |  | Contacts |
| MainWindow.xaml:586 | RadioButton | &#xE8B8; | Settings |  | Settings |
| MainWindow.xaml:603 | RadioButton | &#xE869; | Developer Tools |  | Developer Tools |
| MainWindow.xaml:620 | Button | &#xEB8E; | Live Log |  | Open or focus the live log window |
| MainWindow.xaml:665 | Button | &#xE627; | {Binding ConnectQuickDeviceCommand} | Clean reconnect to saved device |
| MainWindow.xaml:692 | Button | {Binding QuickConnectSidebarLabel} | {Binding ConnectQuickDeviceCommand} |  |
| MainWindow.xaml:701 | Button | Connection Settings |  |  |
| MainWindow.xaml:737 | Button | &#xE627; | {Binding ConnectQuickDeviceCommand} | {Binding QuickConnectSidebarLabel} |
| MainWindow.xaml:745 | Button | &#xE8B8; |  | Connection settings |
| MainWindow.xaml:808 | Button | Connect | {Binding ReconnectCommand} |  |
| MainWindow.xaml:812 | Button | Choose device |  |  |
| MainWindow.xaml:816 | Button | &#xE5CD; | {Binding DismissReconnectCommand} |  |
| MainWindow.xaml:843 | Button | Yes | {Binding ImportPendingContactsCommand} |  |
| MainWindow.xaml:847 | Button | No | {Binding SkipPendingContactsCommand} |  |
| MainWindow.xaml:882 | Button | Use New Build | {Binding AcceptBuildUpdateCommand} |  |
| MainWindow.xaml:887 | Button | Not Yet | {Binding SnoozeBuildUpdateCommand} |  |
| MainWindow.xaml:904 | Button | &#xE7F4; | New Build Available | {Binding ShowBuildUpdatePromptCommand} |  |
| MainWindow.xaml:973 | Button |  | {Binding MuteMicCommand} |  |
| MainWindow.xaml:993 | Button | Accept | {Binding AnswerCommand} |  |
| MainWindow.xaml:1006 | Button |  | {Binding HangUpCommand} |  |
| MainWindow.xaml:1078 | Button | &#xE145; |  | New message |
| MainWindow.xaml:1083 | Button | &#xE164; | {Binding ToggleConversationSortCommand} |  |
| MainWindow.xaml:1098 | Button | &#xE5CD; | {Binding CloseMessagesListPaneCommand} | Hide threads |
| MainWindow.xaml:1138 | Button | All | {Binding SetConversationFilterCommand} |  |
| MainWindow.xaml:1159 | Button | Unread | {Binding SetConversationFilterCommand} |  |
| MainWindow.xaml:1180 | Button | Pinned | {Binding SetConversationFilterCommand} |  |
| MainWindow.xaml:1201 | Button | Muted | {Binding SetConversationFilterCommand} |  |
| MainWindow.xaml:1222 | Button | Blocked | {Binding SetConversationFilterCommand} |  |
| MainWindow.xaml:1299 | MenuItem | Mark read | {Binding DataContext.MarkConversationReadCommand, RelativeSource={RelativeSource AncestorType=ListBox}} |  |
| MainWindow.xaml:1302 | MenuItem | Mark unread | {Binding DataContext.MarkConversationUnreadCommand, RelativeSource={RelativeSource AncestorType=ListBox}} |  |
| MainWindow.xaml:1306 | MenuItem | Pin / unpin | {Binding DataContext.ToggleConversationPinnedCommand, RelativeSource={RelativeSource AncestorType=ListBox}} |  |
| MainWindow.xaml:1309 | MenuItem | Mute / unmute alerts | {Binding DataContext.ToggleConversationAlertsMutedCommand, RelativeSource={RelativeSource AncestorType=ListBox}} |  |
| MainWindow.xaml:1312 | MenuItem | Block / unblock locally | {Binding DataContext.ToggleConversationBlockedCommand, RelativeSource={RelativeSource AncestorType=ListBox}} |  |
| MainWindow.xaml:1523 | Button | &#xE316; | {Binding ConversationSearchPreviousCommand} | Previous match |
| MainWindow.xaml:1527 | Button | &#xE313; | {Binding ConversationSearchNextCommand} | Next match |
| MainWindow.xaml:1531 | Button | &#xE5CD; | {Binding ClearConversationSearchCommand} | Clear search |
| MainWindow.xaml:1568 | Button | &#xE14B; | {Binding ToggleConversationBlockedCommand} | {Binding SelectedConversationBlockTooltip} |
| MainWindow.xaml:1572 | Button | &#xF10D; | {Binding ToggleConversationPinnedCommand} | {Binding SelectedConversationPinTooltip} |
| MainWindow.xaml:1576 | Button | &#xE7F6; | {Binding ToggleConversationAlertsMutedCommand} | {Binding SelectedConversationAlertsTooltip} |
| MainWindow.xaml:1580 | Button | &#xE151; | {Binding MarkConversationReadCommand} | Mark read |
| MainWindow.xaml:1585 | Button | &#xF18A; | {Binding MarkConversationUnreadCommand} | Mark unread |
| MainWindow.xaml:1590 | Button | &#xE7FE; | {Binding SaveAsContactCommand} | Add contact |
| MainWindow.xaml:1596 | Button | &#xE3C9; | {Binding EditContactCommand} | Edit contact |
| MainWindow.xaml:1602 | Button | &#xE0B0; |  | Call |
| MainWindow.xaml:1693 | Button | &#xE316; | {Binding ConversationSearchPreviousCommand} | Previous match |
| MainWindow.xaml:1697 | Button | &#xE313; | {Binding ConversationSearchNextCommand} | Next match |
| MainWindow.xaml:1701 | Button | &#xE5CD; | {Binding ClearConversationSearchCommand} | Clear search |
| MainWindow.xaml:1738 | Button | &#xE14B; | {Binding ToggleConversationBlockedCommand} | {Binding SelectedConversationBlockTooltip} |
| MainWindow.xaml:1742 | Button | &#xF10D; | {Binding ToggleConversationPinnedCommand} | {Binding SelectedConversationPinTooltip} |
| MainWindow.xaml:1746 | Button | &#xE7F6; | {Binding ToggleConversationAlertsMutedCommand} | {Binding SelectedConversationAlertsTooltip} |
| MainWindow.xaml:1750 | Button | &#xE151; | {Binding MarkConversationReadCommand} | Mark read |
| MainWindow.xaml:1755 | Button | &#xF18A; | {Binding MarkConversationUnreadCommand} | Mark unread |
| MainWindow.xaml:1760 | Button | &#xE7FE; | {Binding SaveAsContactCommand} | Add contact |
| MainWindow.xaml:1766 | Button | &#xE3C9; | {Binding EditContactCommand} | Edit contact |
| MainWindow.xaml:1772 | Button | &#xE0B0; |  | Call |
| MainWindow.xaml:1831 | Button | Show threads | {Binding OpenMessagesListPaneCommand} |  |
| MainWindow.xaml:1897 | MenuItem | Copy |  |  |
| MainWindow.xaml:1898 | MenuItem | Forward… |  |  |
| MainWindow.xaml:1899 | MenuItem | Call |  |  |
| MainWindow.xaml:1900 | MenuItem | {Binding PinActionLabel} |  |  |
| MainWindow.xaml:1902 | MenuItem | Delete |  |  |
| MainWindow.xaml:1985 | Button | Save | {Binding DataContext.SaveAttachmentCommand, RelativeSource={RelativeSource AncestorType=Window}} |  |
| MainWindow.xaml:2036 | Button | &#xF08A; |  | Copy |
| MainWindow.xaml:2040 | Button | &#xE154; |  | Forward |
| MainWindow.xaml:2044 | Button | &#xE0B0; |  | Call |
| MainWindow.xaml:2048 | Button | &#xE872; |  | Delete |
| MainWindow.xaml:2052 | Button | &#xF10D; |  | {Binding PinActionLabel} |
| MainWindow.xaml:2070 | MenuItem | Copy |  |  |
| MainWindow.xaml:2071 | MenuItem | Forward… |  |  |
| MainWindow.xaml:2072 | MenuItem | Call |  |  |
| MainWindow.xaml:2073 | MenuItem | {Binding PinActionLabel} |  |  |
| MainWindow.xaml:2075 | MenuItem | Delete |  |  |
| MainWindow.xaml:2157 | Button | Save | {Binding DataContext.SaveAttachmentCommand, RelativeSource={RelativeSource AncestorType=Window}} |  |
| MainWindow.xaml:2256 | Button | &#xF08A; |  | Copy |
| MainWindow.xaml:2260 | Button | &#xE154; |  | Forward |
| MainWindow.xaml:2264 | Button | &#xE0B0; |  | Call |
| MainWindow.xaml:2268 | Button | &#xE872; |  | Delete |
| MainWindow.xaml:2272 | Button | &#xF10D; |  | {Binding PinActionLabel} |
| MainWindow.xaml:2293 | Button | &#xE313; |  | Scroll to latest |
| MainWindow.xaml:2340 | Button | Undo | {Binding UndoLastDeletedMessageCommand} |  |
| MainWindow.xaml:2362 | Button | &#xE226; | {Binding AddComposeAttachmentCommand} | Attach pictures, files, or contact cards. DeskPhone will send them as MMS when the phone accepts Bluetooth MAP media sending. |
| MainWindow.xaml:2399 | Button | &#xE5CD; | {Binding DataContext.RemoveComposeAttachmentCommand, RelativeSource={RelativeSource AncestorType=Window}} |  |
| MainWindow.xaml:2410 | Button | &#xE163; | {Binding SendMessageCommand} |  |
| MainWindow.xaml:2483 | Button | All | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:2499 | Button | Missed | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:2537 | Button | In | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:2553 | Button | Out | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:2573 | Button | &#xE0BC; | Keypad | {Binding ToggleConversationDialerPaneCommand} | Show keypad |
| MainWindow.xaml:2592 | Button | &#xE872; | {Binding DeleteAllCallHistoryCommand} | Delete all call history |
| MainWindow.xaml:2627 | Button | Undo | {Binding UndoCallHistoryDeleteCommand} |  |
| MainWindow.xaml:2670 | Button | &#xF10D; | {Binding PreviewBody} | {Binding TimestampDisplay} | You |  |  |
| MainWindow.xaml:2826 | Button | &#xE625; |  | Message this number |
| MainWindow.xaml:2831 | Button | &#xE0B0; |  | Call this number |
| MainWindow.xaml:2836 | Button | &#xE14B; | {Binding DataContext.ToggleCallRecordBlockedCommand, RelativeSource={RelativeSource AncestorType=Window}} | Block / unblock locally |
| MainWindow.xaml:2841 | Button | &#xE872; | {Binding DataContext.DeleteCallRecordCommand, RelativeSource={RelativeSource AncestorType=Window}} | Delete call entry |
| MainWindow.xaml:2871 | Button | &#xE5CD; | {Binding CloseConversationDialerPaneCommand} | Hide keypad |
| MainWindow.xaml:2893 | Button | &#xE14A; |  |  |
| MainWindow.xaml:2931 | Button | Text |  |  |
| MainWindow.xaml:2938 | Button | Call |  |  |
| MainWindow.xaml:2952 | Button | 1 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2953 | Button | 2 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2954 | Button | 3 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2955 | Button | 4 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2956 | Button | 5 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2957 | Button | 6 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2958 | Button | 7 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2959 | Button | 8 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2960 | Button | 9 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2961 | Button | * | {Binding DialPadCommand} |  |
| MainWindow.xaml:2962 | Button | 0 | {Binding DialPadCommand} |  |
| MainWindow.xaml:2963 | Button | # | {Binding DialPadCommand} |  |
| MainWindow.xaml:2966 | Button | &#xE0D2; | Voicemail | {Binding DialVoicemailCommand} |  |
| MainWindow.xaml:2992 | Button | &#xE0B0; | Call | {Binding DialCommand} |  |
| MainWindow.xaml:3036 | Button | Cancel |  |  |
| MainWindow.xaml:3069 | Button | {Binding DisplayName} | {Binding FormattedPhone} | {Binding DataContext.PickComposeContactCommand, RelativeSource={RelativeSource AncestorType=Window}} |  |
| MainWindow.xaml:3092 | Button | Save as contact | {Binding SaveAsContactCommand} |  |
| MainWindow.xaml:3098 | Button | Edit contact | {Binding EditContactCommand} |  |
| MainWindow.xaml:3124 | Button | &#xE226; | {Binding AddComposeAttachmentCommand} | Attach pictures, files, or contact cards. DeskPhone will send them as MMS when the phone accepts Bluetooth MAP media sending. |
| MainWindow.xaml:3136 | Button | Send Message | {Binding SendMessageCommand} |  |
| MainWindow.xaml:3153 | Button | &#xE5CD; | {Binding DataContext.RemoveComposeAttachmentCommand, RelativeSource={RelativeSource AncestorType=Window}} |  |
| MainWindow.xaml:3204 | Button | Show recents | {Binding OpenRecentCallsPaneCommand} |  |
| MainWindow.xaml:3211 | Button | Show dialer | {Binding OpenDialerPaneCommand} |  |
| MainWindow.xaml:3243 | Button | &#xE872; | {Binding DeleteAllCallHistoryCommand} | Delete all call history |
| MainWindow.xaml:3259 | Button | &#xE5CD; | {Binding CloseRecentCallsPaneCommand} | Hide recents |
| MainWindow.xaml:3273 | Button | All | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:3289 | Button | Missed | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:3327 | Button | Incoming | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:3343 | Button | Outgoing | {Binding SetCallHistoryFilterCommand} |  |
| MainWindow.xaml:3378 | Button | Undo | {Binding UndoCallHistoryDeleteCommand} |  |
| MainWindow.xaml:3484 | Button | &#xE625; |  | Message this number |
| MainWindow.xaml:3489 | Button | &#xE0B0; |  | Call this number |
| MainWindow.xaml:3494 | Button | &#xE14B; | {Binding DataContext.ToggleCallRecordBlockedCommand, RelativeSource={RelativeSource AncestorType=Window}} | Block / unblock locally |
| MainWindow.xaml:3499 | Button | &#xE872; | {Binding DataContext.DeleteCallRecordCommand, RelativeSource={RelativeSource AncestorType=Window}} | Delete call entry |
| MainWindow.xaml:3547 | Button | &#xE5CD; | {Binding CloseDialerPaneCommand} | Hide dialer |
| MainWindow.xaml:3569 | Button | &#xE14A; |  |  |
| MainWindow.xaml:3593 | Button | Save as contact | {Binding SaveAsContactCommand} |  |
| MainWindow.xaml:3599 | Button | Edit contact | {Binding EditContactCommand} |  |
| MainWindow.xaml:3628 | Button | Text |  |  |
| MainWindow.xaml:3635 | Button | Call |  |  |
| MainWindow.xaml:3650 | Button | 1 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3651 | Button | 2 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3652 | Button | 3 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3653 | Button | 4 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3654 | Button | 5 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3655 | Button | 6 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3656 | Button | 7 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3657 | Button | 8 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3658 | Button | 9 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3659 | Button | * | {Binding DialPadCommand} |  |
| MainWindow.xaml:3660 | Button | 0 | {Binding DialPadCommand} |  |
| MainWindow.xaml:3661 | Button | # | {Binding DialPadCommand} |  |
| MainWindow.xaml:3664 | Button | &#xE0D2; | Voicemail | {Binding DialVoicemailCommand} |  |
| MainWindow.xaml:3691 | Button | &#xE0B0; | {Binding DialCommand} |  |
| MainWindow.xaml:3766 | Button | New Contact | {Binding NewContactCommand} |  |

## Web Parity Rule

The current polished web page is now considered a prototype. The next acceptable production pass must use this inventory as the checklist, not screenshots or memory alone.
