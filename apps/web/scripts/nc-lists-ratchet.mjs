#!/usr/bin/env node
/**
 * nc-lists ratchet — "layout may fork, data may not".
 *
 * NerveCenter renders the same five cards in three separate branches. In
 * 4.114.11 one of those branches re-derived its own task order in private, 400
 * lines from its render and 1,500 from the fix it silently undid, and pinned
 * tasks stopped being pinned (tickets mEyXdMpnpv411HyWo8Eg / s0wx0jmnqGL5C4ESV4mk).
 * No review could have caught that. This check makes the class of bug impossible.
 *
 * The rule, enforced here:
 *   1. Every display list is computed inside the marker-fenced NC DISPLAY LISTS
 *      block. No `.sort(` may appear inside the NerveCenter component function
 *      outside that block. (Module-level helpers above the component are exempt —
 *      they are not display lists. A genuinely non-display sort inside the
 *      component may carry a trailing `// nc-lists-exempt: <reason>`.)
 *   2. No consumer may re-order what the block handed it: `ncLists.<x>` is never
 *      followed by `.sort(`, `.filter(` or `.reverse(`. `.slice(` is fine — a cap
 *      is presentation, and it does not reorder anything.
 *
 * Unlike the GM3 ratchet this has no baseline to walk down: it started clean, so
 * the target is and stays 0. See docs/ops/NC_ONE_SOURCE_PLAN.md.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const FILE = path.join(root, "src/08-app-split/components/NerveCenter.jsx");

const START = "── NC DISPLAY LISTS: start ";
const END = "── NC DISPLAY LISTS: end ";
const COMPONENT = "function NerveCenter(";

const src = fs.readFileSync(FILE, "utf8");
const lines = src.split(/\r?\n/);

const rel = path.relative(root, FILE).replace(/\\/g, "/");
const violations = [];
const at = i => `${rel}:${i + 1}`;

const startLine = lines.findIndex(l => l.includes(START));
const endLine = lines.findIndex(l => l.includes(END));
const componentLine = lines.findIndex(l => l.includes(COMPONENT));

if (startLine === -1 || endLine === -1 || endLine < startLine) {
  console.error(`nc:lists — the NC DISPLAY LISTS marker block is missing from ${rel}.`);
  console.error("Every card's contents and order must be computed in one fenced block.");
  process.exit(1);
}

lines.forEach((line, i) => {
  const inBlock = i >= startLine && i <= endLine;
  const inComponent = componentLine !== -1 && i > componentLine;
  const exempt = line.includes("nc-lists-exempt:");
  const comment = /^\s*(\/\/|\*|\/\*)/.test(line);

  if (line.includes(".sort(") && inComponent && !inBlock && !exempt && !comment)
    violations.push(`${at(i)}  a display list is ordered outside the NC DISPLAY LISTS block\n      ${line.trim()}`);

  const reorder = line.match(/ncLists\.\w+\s*\.\s*(sort|filter|reverse)\(/);
  if (reorder && !comment)
    violations.push(`${at(i)}  a branch re-orders a shared list with .${reorder[1]}()\n      ${line.trim()}`);
});

if (violations.length) {
  console.error(`\nnc:lists — ${violations.length} violation${violations.length === 1 ? "" : "s"} (target is 0):\n`);
  violations.forEach(v => console.error("  " + v));
  console.error(`
  Fix: move the derivation into the NC DISPLAY LISTS block and have every branch
  read it verbatim. A cap (.slice) is presentation and stays in the branch; a
  different ORDER is a product decision and belongs in the block behind a named
  flag. See docs/ops/NC_ONE_SOURCE_PLAN.md.
`);
  process.exit(1);
}

console.log(`nc:lists — clean (0 violations). One render source, ${endLine - startLine} lines of it.`);
