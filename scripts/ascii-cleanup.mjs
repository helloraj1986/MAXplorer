import fs from "node:fs";
import path from "node:path";

const replacements = [
  ["…", "..."],
  ["·", " - "],
  ["Â·", " - "],
  ["â€¦", "..."],
  ["â€œ", '"'],
  ["â€", '"'],
  ["âŒ˜", "Cmd"],
  ["â‡§", "Shift"],
  ["âŒ¥", "Alt"],
  ["⌘", "Cmd"],
  ["⇧", "Shift"],
  ["⌥", "Alt"],
  ["→", "->"],
  ["—", "-"],
  ["–", "-"],
];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file);
    } else if (/\.(tsx?|css)$/.test(file)) {
      let text = fs.readFileSync(file, "utf8");
      for (const [from, to] of replacements) text = text.split(from).join(to);
      fs.writeFileSync(file, text, "utf8");
    }
  }
}

walk("src");
console.log("done");
