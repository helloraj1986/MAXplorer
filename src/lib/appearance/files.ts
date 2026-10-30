import { api, isTauri } from "../api";
import { copyTextToClipboard } from "../clipboard";
import {
  buildIconPackPackage,
  buildThemePackage,
  iconPackageFileName,
  packageFileName,
  type IconPack,
  type ThemeDesign,
} from "./model";

export interface ExportResult {
  fileName: string;
  /** Absolute path when saved by the desktop app; null for browser downloads. */
  path: string | null;
}

function browserDownload(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportText(fileName: string, contents: string): Promise<ExportResult> {
  if (isTauri) {
    const path = await api.saveAppearancePackage(fileName, contents);
    return { fileName, path };
  }
  browserDownload(fileName, contents);
  return { fileName, path: null };
}

/** Saves a portable `.maxTheme` package and returns its location. */
export async function exportThemePackageFile(design: ThemeDesign): Promise<ExportResult> {
  return exportText(packageFileName(design), JSON.stringify(buildThemePackage(design), null, 2));
}

/** Saves a portable `.maxIcons` package and returns its location. */
export async function exportIconPackFile(pack: IconPack): Promise<ExportResult> {
  return exportText(iconPackageFileName(pack), JSON.stringify(buildIconPackPackage(pack), null, 2));
}

/** Copies the package JSON so it can be pasted into a message or email. */
export async function shareThemePackage(design: ThemeDesign): Promise<boolean> {
  const text = JSON.stringify(buildThemePackage(design), null, 2);
  return copyTextToClipboard(text);
}

export async function shareIconPack(pack: IconPack): Promise<boolean> {
  const text = JSON.stringify(buildIconPackPackage(pack), null, 2);
  return copyTextToClipboard(text);
}

export async function readPackageFile(file: File): Promise<string> {
  if (file.size > 1_000_000) {
    throw new Error("This package is too large. Theme packages are usually a few kilobytes.");
  }
  return file.text();
}
