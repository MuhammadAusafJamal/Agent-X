#!/bin/bash
# Claude Code status line: model + context-fill bar + plan usage (5h / weekly) + folder.
# Parses the stdin JSON with Node (jq is not installed on this machine).
#
# Plan-usage (rate_limits) fields only appear for Pro/Max plans and only AFTER the
# first API response in a session; until then each window renders as a dim "-- ".

node -e '
const fs = require("fs");
let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch (e) {}
// PowerShell 5.1 prepends a UTF-8 BOM when piping to a native exe; JSON.parse
// throws on it, which would silently render the whole line as defaults.
raw = raw.replace(/^﻿/, "").trim();
let j = {};
try { j = JSON.parse(raw); } catch (e) {}

const reset = "\x1b[0m";
const cyan  = "\x1b[36m";
const dim   = "\x1b[90m";
const clamp = (n) => { n = Math.round(n); if (n < 0) n = 0; if (n > 100) n = 100; return n; };
const tone  = (n) => (n >= 80 ? "\x1b[31m" : n >= 50 ? "\x1b[33m" : "\x1b[32m");

const model = (j.model && j.model.display_name) || "Claude";

const dir = (j.workspace && j.workspace.current_dir) || j.cwd || "";
const folder = dir.split(/[\\/]/).filter(Boolean).pop() || "";

// --- context-fill bar ---
const ctx = clamp((j.context_window && j.context_window.used_percentage) || 0);
const width = 10;
let filled = Math.round((ctx * width) / 100);
if (filled > width) filled = width;
if (filled < 0) filled = 0;
const bar = "#".repeat(filled) + "-".repeat(width - filled);
const ctxStr = tone(ctx) + "[" + bar + "] " + ctx + "%ctx" + reset;

// --- plan usage: 5-hour rolling window + 7-day (weekly) window ---
const rl = j.rate_limits || {};
const win = (obj, label) => {
  if (obj && typeof obj.used_percentage === "number") {
    const p = clamp(obj.used_percentage);
    return tone(p) + label + " " + p + "%" + reset;
  }
  return dim + label + " --" + reset;
};
const usageStr = win(rl.five_hour, "5h") + dim + " · " + reset + win(rl.seven_day, "wk");

// --- caveman badge: real plugin flag + savings suffix ---
// Reads ~/.claude/.caveman-active (mode) and .caveman-statusline-suffix (savings,
// pre-rendered by /caveman-stats). Refuses symlinks; strips control bytes.
const path = require("path");
const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude");
const amber = "\x1b[38;5;172m";
const readSafe = (p, cap) => {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return "";
    return fs.readFileSync(p, "utf8").slice(0, cap);
  } catch (e) { return ""; }
};
let caveStr = "";
let mode = readSafe(path.join(cfgDir, ".caveman-active"), 64).replace(/[\r\n]/g, "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const MODES = ["off","lite","full","ultra","wenyan-lite","wenyan","wenyan-full","wenyan-ultra","commit","review","compress"];
if (MODES.includes(mode)) {
  const badge = (!mode || mode === "full") ? "[CAVEMAN]" : "[CAVEMAN:" + mode.toUpperCase() + "]";
  caveStr = amber + badge + reset;
  const savings = readSafe(path.join(cfgDir, ".caveman-statusline-suffix"), 64).replace(/[\x00-\x1f]/g, "");
  if (savings) caveStr += " " + amber + savings + reset;
  caveStr += "  ";
}

process.stdout.write(
  caveStr +
  cyan + model + reset + "  " +
  ctxStr + "  " +
  usageStr + "  " +
  "📁 " + folder
);
'
