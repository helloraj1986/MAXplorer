#!/usr/bin/env node
/**
 * Print MAXplorer's local diagnostic log. Usage:
 *   npm run logs
 *   npm run logs -- --tail 500
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const identifier = "com.replica.win11explorer";
const home = os.homedir();
const candidates = [];
if (process.platform === "darwin") {
  candidates.push(path.join(home, "Library", "Application Support", identifier, "logs", "maxplorer.log"));
} else if (process.platform === "win32") {
  candidates.push(path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), identifier, "logs", "maxplorer.log"));
} else {
  candidates.push(path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), identifier, "logs", "maxplorer.log"));
}
candidates.push(path.join(os.tmpdir(), "maxplorer", "logs", "maxplorer.log"));

const index = process.argv.indexOf("--tail");
const tail = index >= 0 ? Math.max(10, Number(process.argv[index + 1]) || 300) : 300;
const existing = candidates.find((file) => fs.existsSync(file));

if (!existing) {
  console.error("MAXplorer diagnostic log was not found.");
  console.error("Launch MAXplorer, reproduce the crash, then run `npm run logs` again.");
  console.error("Expected locations:");
  for (const candidate of candidates) console.error(`  ${candidate}`);
  process.exit(1);
}

const text = fs.readFileSync(existing, "utf8");
const lines = text.split(/\r?\n/);
const output = lines.slice(-tail).join("\n");
console.log(`Log file: ${existing}`);
console.log(`Size: ${fs.statSync(existing).size} bytes · showing last ${Math.min(tail, lines.length)} lines`);
console.log("─".repeat(72));
console.log(output);
