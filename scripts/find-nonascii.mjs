import fs from "node:fs";
import path from "node:path";

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file);
    } else if (/\.(tsx?|css|md)$/.test(file)) {
      const text = fs.readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (/[^\x00-\x7F]/.test(line)) {
          const points = [...line]
            .filter((character) => character.codePointAt(0) > 127)
            .map((character) => `U+${character.codePointAt(0).toString(16)}`)
            .join(",");
          console.log(`${file}:${index + 1}: ${JSON.stringify(line)} cp=${points}`);
        }
      });
    }
  }
}

walk("src");
