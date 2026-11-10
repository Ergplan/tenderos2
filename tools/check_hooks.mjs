// Rules-of-hooks guard for the React components under web/src: a hook called after an early
// return (a `return` at the top of a component body, or directly inside an `if` there) renders a
// different number of hooks from one render to the next and crashes the page with React error
// #310 ("Rendered more hooks than during the previous render"). The WhatIfStep did it twice
// (Nov 2026). Run from the repository root:   node tools/check_hooks.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../web/src", import.meta.url).pathname;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(jsx|js)$/.test(name)) files.push(p);
  }
})(ROOT);

const HOOK = /\buse[A-Z]\w*\s*\(/;
const COMPONENT = /^(export default function|export function|function)\s+([A-Z]\w*)\s*\(/;
const problems = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  let comp = null; // { name, start, depth, earlyReturn }
  let depth = 0;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\/\/.*$/, "");
    const m = raw.match(COMPONENT);
    if (depth === 0 && m) comp = { name: m[2], start: idx + 1, earlyReturn: null };
    // an early return: `return` at body depth 1, or at depth 2 right inside an `if (...) {` at depth 1
    if (comp && !comp.earlyReturn) {
      const trimmed = line.trim();
      const isReturn = /^return\b/.test(trimmed);
      if (isReturn && depth === 1 && !/^\s{2}return \($/.test(raw) && !/^\s{2}return </.test(raw)) comp.earlyReturn = idx + 1;
      if (isReturn && depth === 2 && /^\s{2}if \(/.test(lines[idx - 1] || "")) comp.earlyReturn = idx + 1;
    }
    if (comp && comp.earlyReturn && idx + 1 > comp.earlyReturn && depth >= 1 && HOOK.test(line)) {
      problems.push(`${path.relative(ROOT, file)}:${idx + 1} in ${comp.name}: hook after the early return at line ${comp.earlyReturn}: ${line.trim().slice(0, 90)}`);
    }
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (comp && depth === 0 && idx + 1 > comp.start) comp = null;
  });
}
if (problems.length) {
  console.error(`check_hooks: ${problems.length} hook(s) after an early return\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check_hooks: ok (${files.length} files, no hook after an early return)`);
