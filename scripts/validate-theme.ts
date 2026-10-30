import { readFileSync } from "node:fs";
import { contrastRatio } from "../src/lib/appearance/color";
import { parseThemePackage, validateThemeDesign } from "../src/lib/appearance/model";

const file = process.argv[2];
if (!file) {
  console.error("Usage: vite-node --script scripts/validate-theme.ts <file.maxTheme>");
  process.exit(2);
}

const parsed = parseThemePackage(readFileSync(file, "utf8"));
if (!parsed.ok) {
  console.error(`Invalid theme package: ${parsed.error}`);
  process.exit(1);
}

const theme = parsed.value.theme;
const validation = validateThemeDesign(theme);
const surfaceContrast = contrastRatio(theme.palette.text, theme.palette.surface);
const backgroundContrast = contrastRatio(theme.palette.text, theme.palette.background);

console.log(`Theme: ${theme.name}`);
console.log(`Package: ${theme.packageId}`);
console.log(`Base: ${theme.base} / ${theme.appearance}`);
console.log(`Text on surface: ${surfaceContrast}:1`);
console.log(`Text on background: ${backgroundContrast}:1`);
console.log(`Validation: ${validation.ok ? "PASS" : "FAIL"}`);

for (const issue of validation.issues) {
  console.log(`- [${issue.level}] ${issue.message}`);
}

if (!validation.ok) process.exit(1);
