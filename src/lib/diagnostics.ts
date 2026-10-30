import { api, isTauri } from "./api";

let installed = false;

function stackOf(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Local-only diagnostics. Messages are mirrored to the browser console and,
 * inside Tauri, appended to the rotating application log. Failures to log must
 * never throw or recurse into another error handler.
 */
export function logDiagnostic(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  context = "frontend",
): void {
  const line = `[${context}] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
  if (!isTauri) return;
  void api.logFrontendEvent(level, message, context).catch(() => undefined);
}

export function installGlobalDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    logDiagnostic(
      "error",
      `${event.message}\n${event.error instanceof Error ? stackOf(event.error) : ""}`,
      `window.error:${event.filename || "unknown"}:${event.lineno ?? 0}:${event.colno ?? 0}`,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    logDiagnostic(
      "error",
      `Unhandled promise rejection: ${stackOf(event.reason)}`,
      "window.unhandledrejection",
    );
  });
  logDiagnostic("info", "frontend diagnostics installed", "app");
}
