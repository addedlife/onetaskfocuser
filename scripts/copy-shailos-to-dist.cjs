const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "shailos");
const target = path.join(root, "dist", "shailos");

if (!fs.existsSync(source)) {
  console.log("[copy-shailos] shailos folder not found; skipping.");
  process.exit(0);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });
console.log("[copy-shailos] copied shailos to dist.");
