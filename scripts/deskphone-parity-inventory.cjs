const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "..");
const defaultDeskPhoneRoot = path.resolve(
  repoRoot,
  "..",
  "..",
  "PC as Bluetooth call - text interface",
  "DeskPhone"
);
const deskPhoneRoot = path.resolve(process.argv[2] || defaultDeskPhoneRoot);
const outputDir = path.join(repoRoot, "docs", "deskphone-parity");

const ignoreParts = new Set(["bin", "obj", "deployed-builds", ".git"]);
const ignorePathFragments = [
  `${path.sep}docs${path.sep}backups${path.sep}`,
  `${path.sep}scratch${path.sep}`,
  `${path.sep}testsprite_tests${path.sep}`,
];

const xamlElementTags = new Set([
  "Window", "Application", "ResourceDictionary", "Style", "Setter", "ControlTemplate",
  "DataTemplate", "ItemsPanelTemplate", "Grid", "Border", "StackPanel", "DockPanel",
  "WrapPanel", "UniformGrid", "ScrollViewer", "Viewbox", "ContentControl", "ContentPresenter",
  "Button", "ToggleButton", "RadioButton", "CheckBox", "TextBlock", "TextBox", "PasswordBox",
  "ComboBox", "ListBox", "ListView", "ItemsControl", "DataGrid", "MenuItem", "Popup",
  "Slider", "ProgressBar", "Image", "Path", "Rectangle", "Ellipse", "TabControl",
  "TabItem", "Expander", "Separator", "ToolTip", "Run", "Hyperlink"
]);

const actionTags = new Set(["Button", "ToggleButton", "RadioButton", "CheckBox", "MenuItem", "Hyperlink"]);
const layoutTags = new Set([
  "Window", "Grid", "Border", "StackPanel", "DockPanel", "WrapPanel", "UniformGrid",
  "ScrollViewer", "Viewbox", "ContentControl", "ContentPresenter", "ItemsControl",
  "ListBox", "ListView", "DataGrid", "TabControl", "Expander", "Popup"
]);

function walk(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoreParts.has(entry.name)) continue;
      if (ignorePathFragments.some((part) => full.includes(part))) continue;
      results.push(...walk(full));
    } else {
      if (ignorePathFragments.some((part) => full.includes(part))) continue;
      results.push(full);
    }
  }
  return results;
}

function rel(file) {
  return path.relative(deskPhoneRoot, file).replace(/\\/g, "/");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function lineOfOffset(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function extractAttributes(openingText) {
  const attrs = {};
  const attrRe = /([A-Za-z_][\w:.\-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = attrRe.exec(openingText))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function pickAttrs(attrs, names) {
  const picked = {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(attrs, name)) picked[name] = attrs[name];
  }
  return picked;
}

function classifyTag(tag) {
  if (actionTags.has(tag)) return "action";
  if (layoutTags.has(tag)) return "layout";
  if (tag === "Style" || tag.endsWith("Template") || tag === "Setter") return "style";
  if (tag === "TextBlock" || tag === "TextBox" || tag === "Run") return "text";
  return "control";
}

function parseXaml(file) {
  const text = read(file);
  const entries = [];
  const tagRe = /<([A-Za-z_][\w:.]*)\b/g;
  let match;
  while ((match = tagRe.exec(text))) {
    const rawTag = match[1];
    if (rawTag.startsWith("/")) continue;
    const tag = rawTag.includes(":") ? rawTag.split(":").pop() : rawTag;
    if (!xamlElementTags.has(tag)) continue;

    const start = match.index;
    let end = text.indexOf(">", start);
    if (end < 0) end = Math.min(text.length, start + 500);
    const closingTag = `</${rawTag}>`;
    const closingIndex = text.indexOf(closingTag, end + 1);
    const hasSmallBody = closingIndex > end && closingIndex - start < 20000;
    const bodyEnd = hasSmallBody ? closingIndex + closingTag.length : end;
    const innerText = hasSmallBody ? text.slice(end + 1, closingIndex) : "";
    const childText = Array.from(innerText.matchAll(/\b(?:Text|Content|Header)\s*=\s*"([^"]*)"/g))
      .map((item) => item[1])
      .filter(Boolean)
      .slice(0, 6)
      .join(" | ");
    const opening = text.slice(start, end + 1);
    const attrs = extractAttributes(opening);
    const bindingAttrs = Object.fromEntries(Object.entries(attrs).filter(([, value]) => value.includes("{Binding")));
    const layoutAttrs = pickAttrs(attrs, [
      "Width", "Height", "MinWidth", "MinHeight", "MaxWidth", "MaxHeight",
      "Grid.Row", "Grid.Column", "Grid.RowSpan", "Grid.ColumnSpan",
      "DockPanel.Dock", "Margin", "Padding", "HorizontalAlignment", "VerticalAlignment",
      "HorizontalContentAlignment", "VerticalContentAlignment", "Orientation",
      "Visibility", "Opacity", "CornerRadius", "BorderThickness"
    ]);

    entries.push({
      id: `xaml:${rel(file)}:${lineOfOffset(text, start)}:${entries.length + 1}`,
      file: rel(file),
      lineStart: lineOfOffset(text, start),
      lineEnd: lineOfOffset(text, bodyEnd),
      tag,
      kind: classifyTag(tag),
      name: attrs["x:Name"] || attrs.Name || attrs["x:Key"] || "",
      content: attrs.Content || attrs.Header || attrs.Text || attrs.Title || childText || "",
      childText,
      tooltip: attrs.ToolTip || "",
      command: attrs.Command || "",
      commandParameter: attrs.CommandParameter || "",
      style: attrs.Style || attrs.BasedOn || "",
      targetType: attrs.TargetType || "",
      layout: layoutAttrs,
      bindings: bindingAttrs,
      allAttributes: attrs,
      openingText: opening.replace(/\s+/g, " ").trim(),
    });
  }
  return { text, entries };
}

function parseCommands(file, text) {
  const commands = [];
  const declarationRe = /\bpublic\s+ICommand\s+([A-Za-z_]\w*)\s*\{\s*get;\s*\}/g;
  let match;
  while ((match = declarationRe.exec(text))) {
    commands.push({
      id: `command-declaration:${rel(file)}:${lineOfOffset(text, match.index)}:${match[1]}`,
      file: rel(file),
      line: lineOfOffset(text, match.index),
      name: match[1],
      role: "declaration",
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }

  const relayRe = /([A-Za-z_]\w*)\s*=\s*new\s+RelayCommand\s*\(([^;]+)\);/gs;
  while ((match = relayRe.exec(text))) {
    commands.push({
      id: `command-wiring:${rel(file)}:${lineOfOffset(text, match.index)}:${match[1]}`,
      file: rel(file),
      line: lineOfOffset(text, match.index),
      name: match[1],
      role: "wiring",
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }
  return commands;
}

function parseMethods(file, text) {
  const methods = [];
  const methodRe = /^\s*(public|private|protected|internal)\s+(static\s+)?(async\s+)?([A-Za-z0-9_<>,\[\]\.?]+)\s+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*(?:where\s+[^{]+)?\{/gm;
  let match;
  while ((match = methodRe.exec(text))) {
    methods.push({
      id: `method:${rel(file)}:${lineOfOffset(text, match.index)}:${match[5]}`,
      file: rel(file),
      line: lineOfOffset(text, match.index),
      access: match[1],
      static: !!match[2],
      async: !!match[3],
      returnType: match[4],
      name: match[5],
      parameters: match[6].replace(/\s+/g, " ").trim(),
      signature: match[0].replace(/\s+/g, " ").replace(/\{$/, "").trim(),
    });
  }
  return methods;
}

function parseClasses(file, text) {
  const classes = [];
  const classRe = /^\s*(public|private|protected|internal)?\s*(sealed\s+|partial\s+|static\s+|abstract\s+)*\s*(class|record|enum|interface)\s+([A-Za-z_]\w*)/gm;
  let match;
  while ((match = classRe.exec(text))) {
    classes.push({
      id: `type:${rel(file)}:${lineOfOffset(text, match.index)}:${match[4]}`,
      file: rel(file),
      line: lineOfOffset(text, match.index),
      access: match[1] || "",
      kind: match[3],
      name: match[4],
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }
  return classes;
}

function parseHostApi(file, text) {
  if (!rel(file).endsWith("Services/ControlApiService.cs")) return [];
  const endpoints = [];
  const endpointRe = /(method\s*==\s*"([A-Z]+)"\s*&&\s*)?path\s*==\s*"([^"]+)"/g;
  let match;
  while ((match = endpointRe.exec(text))) {
    endpoints.push({
      id: `host-api:${rel(file)}:${lineOfOffset(text, match.index)}:${match[2] || "GET"}:${match[3]}`,
      file: rel(file),
      line: lineOfOffset(text, match.index),
      method: match[2] || "GET/implicit",
      path: match[3],
      text: match[0].replace(/\s+/g, " ").trim(),
    });
  }
  return endpoints;
}

function toCsv(rows) {
  const columns = ["id", "kind", "tag", "file", "lineStart", "lineEnd", "name", "content", "childText", "tooltip", "command", "style", "layout"];
  const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => {
      const value = column === "layout" ? JSON.stringify(row.layout || {}) : row[column];
      return esc(value);
    }).join(","))
  ].join("\n");
}

function toParityMapCsv(actions) {
  const columns = [
    "inventoryId",
    "source",
    "tag",
    "label",
    "command",
    "tooltip",
    "initialWebStatus",
    "hostApiNeeded",
    "webTarget",
    "notes"
  ];
  const esc = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    columns.join(","),
    ...actions.map((item) => {
      const source = `${item.file}:${item.lineStart}`;
      return [
        item.id,
        source,
        item.tag,
        item.content || item.name || item.tooltip,
        item.command,
        item.tooltip,
        "not-yet-reviewed",
        "",
        "",
        ""
      ].map(esc).join(",");
    })
  ].join("\n");
}

if (!fs.existsSync(deskPhoneRoot)) {
  throw new Error(`DeskPhone root not found: ${deskPhoneRoot}`);
}
fs.mkdirSync(outputDir, { recursive: true });

const sourceFiles = walk(deskPhoneRoot).filter((file) => [".xaml", ".cs"].includes(path.extname(file)));
const xamlFiles = sourceFiles.filter((file) => path.extname(file) === ".xaml");
const csFiles = sourceFiles.filter((file) => path.extname(file) === ".cs");

const sourceManifest = sourceFiles.sort().map((file) => {
  const text = read(file);
  return {
    file: rel(file),
    lines: text.split(/\r?\n/).length,
    sha256: sha256(text),
  };
});

const xamlResults = xamlFiles.flatMap((file) => parseXaml(file).entries);
const sourceTexts = new Map(csFiles.map((file) => [file, read(file)]));
const commands = [];
const methods = [];
const types = [];
const hostApi = [];
for (const [file, text] of sourceTexts) {
  commands.push(...parseCommands(file, text));
  methods.push(...parseMethods(file, text));
  types.push(...parseClasses(file, text));
  hostApi.push(...parseHostApi(file, text));
}

const inventory = {
  generatedAt: new Date().toISOString(),
  sourceRoot: deskPhoneRoot,
  rule: "Do not continue DeskPhone Web mimic work until each native element is mapped to implemented, intentionally omitted with reason, or blocked by host capability.",
  counts: {
    sourceFiles: sourceFiles.length,
    xamlFiles: xamlFiles.length,
    csFiles: csFiles.length,
    xamlElements: xamlResults.length,
    actionElements: xamlResults.filter((item) => item.kind === "action").length,
    layoutElements: xamlResults.filter((item) => item.kind === "layout").length,
    styleElements: xamlResults.filter((item) => item.kind === "style").length,
    bindingElements: xamlResults.filter((item) => Object.keys(item.bindings || {}).length > 0).length,
    commandEntries: commands.length,
    methods: methods.length,
    types: types.length,
    hostApiEndpoints: hostApi.length,
  },
  sourceManifest,
  xamlElements: xamlResults,
  actions: xamlResults.filter((item) => item.kind === "action"),
  layoutElements: xamlResults.filter((item) => item.kind === "layout"),
  styleElements: xamlResults.filter((item) => item.kind === "style"),
  commandEntries: commands,
  methods,
  types,
  hostApiEndpoints: hostApi,
};

const jsonPath = path.join(outputDir, "deskphone-static-inventory.json");
const csvPath = path.join(outputDir, "deskphone-ui-elements.csv");
const parityMapPath = path.join(outputDir, "deskphone-web-parity-map.csv");
const mdPath = path.join(outputDir, "DESKPHONE_EXACT_PARITY_INVENTORY.md");

fs.writeFileSync(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`);
fs.writeFileSync(csvPath, `${toCsv(xamlResults)}\n`);
fs.writeFileSync(parityMapPath, `${toParityMapCsv(inventory.actions)}\n`);

const xamlByFile = xamlResults.reduce((acc, item) => {
  acc[item.file] = acc[item.file] || { total: 0, actions: 0, layout: 0, styles: 0 };
  acc[item.file].total += 1;
  if (item.kind === "action") acc[item.file].actions += 1;
  if (item.kind === "layout") acc[item.file].layout += 1;
  if (item.kind === "style") acc[item.file].styles += 1;
  return acc;
}, {});

const topActions = inventory.actions
  .filter((item) => item.command || item.content || item.tooltip || item.name)
  .map((item) => `| ${item.file}:${item.lineStart} | ${item.tag} | ${item.content || item.name || ""} | ${item.command || ""} | ${item.tooltip || ""} |`)
  .slice(0, 160);

const md = `# DeskPhone Exact Parity Inventory

Generated: ${inventory.generatedAt}

Source root: \`${deskPhoneRoot}\`

## Gate

No further DeskPhone Web clone work should proceed from visual guesswork. Each native DeskPhone item must be mapped to one of these states before implementation:

- \`implemented-web\`: copied into the web page with matching behavior or a documented browser equivalent.
- \`host-api-needed\`: visible in web, but blocked until the Windows host exposes a command.
- \`native-only\`: intentionally kept in native DeskPhone with a reason.
- \`not-yet-reviewed\`: not allowed to drive implementation yet.

## Counts

| Area | Count |
| --- | ---: |
| Source files scanned | ${inventory.counts.sourceFiles} |
| XAML files scanned | ${inventory.counts.xamlFiles} |
| C# files scanned | ${inventory.counts.csFiles} |
| XAML UI/style/layout elements | ${inventory.counts.xamlElements} |
| Action elements: buttons, menu items, toggles, hyperlinks | ${inventory.counts.actionElements} |
| Layout/frame elements | ${inventory.counts.layoutElements} |
| Style/template elements | ${inventory.counts.styleElements} |
| Elements with bindings | ${inventory.counts.bindingElements} |
| Command declarations and wiring entries | ${inventory.counts.commandEntries} |
| C# methods/functions | ${inventory.counts.methods} |
| C# types | ${inventory.counts.types} |
| Host API endpoints | ${inventory.counts.hostApiEndpoints} |

## Files Written

- \`docs/deskphone-parity/deskphone-static-inventory.json\`: full static ledger.
- \`docs/deskphone-parity/deskphone-ui-elements.csv\`: spreadsheet-friendly UI element list.
- \`docs/deskphone-parity/deskphone-web-parity-map.csv\`: action-by-action web parity review queue.
- \`docs/deskphone-parity/DESKPHONE_EXACT_PARITY_INVENTORY.md\`: this executive summary.

## XAML Element Counts By File

| File | Total | Actions | Layout | Styles |
| --- | ---: | ---: | ---: | ---: |
${Object.entries(xamlByFile).sort(([a], [b]) => a.localeCompare(b)).map(([file, counts]) => `| ${file} | ${counts.total} | ${counts.actions} | ${counts.layout} | ${counts.styles} |`).join("\n")}

## Host API Endpoints

| File:line | Method | Path |
| --- | --- | --- |
${hostApi.map((item) => `| ${item.file}:${item.line} | ${item.method} | \`${item.path}\` |`).join("\n")}

## First 160 Action Elements

This is a preview only. The JSON file contains the full list.

| File:line | Tag | Label/key | Command binding | Tooltip |
| --- | --- | --- | --- | --- |
${topActions.join("\n")}

## Web Parity Rule

The current polished web page is now considered a prototype. The next acceptable production pass must use this inventory as the checklist, not screenshots or memory alone.
`;

fs.writeFileSync(mdPath, md);

console.log(JSON.stringify({
  outputDir,
  counts: inventory.counts,
  files: [jsonPath, csvPath, mdPath],
  parityMap: parityMapPath,
}, null, 2));
