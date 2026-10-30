import { ThemeCreator } from "../components/appearance/ThemeCreator";
import { AppearanceSettings } from "../components/appearance/AppearanceSettings";
import type { ThemeCreatorMode } from "../lib/appearance/model";
import type { ThemeCreatorStart } from "../lib/types";

/**
 * Development-only portrait of the Theme Creator used for documentation
 * screenshots and visual review. It renders the real component and is never
 * included in the production bundle.
 */
export function AppearancePreview() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "settings") {
    return (
      <div className="app-shell" style={{ overflow: "auto" }}>
        <div
          style={{
            width: "min(880px, calc(100vw - 32px))",
            margin: "28px auto",
            padding: 20,
            background: "var(--surface-raised)",
            border: "1px solid var(--menu-border)",
            borderRadius: 10,
            boxShadow: "var(--shadow-2)",
          }}
        >
          <AppearanceSettings />
        </div>
      </div>
    );
  }
  const stepParam = Number(params.get("step") ?? "0");
  const step = Number.isFinite(stepParam) ? Math.min(6, Math.max(0, stepParam)) : 0;
  const presetId = params.get("preset") ?? "midnight-dark";
  const mode: ThemeCreatorMode = params.get("mode") === "advanced" ? "advanced" : "simple";
  const start: ThemeCreatorStart = { kind: "preset", presetId };
  return (
    <div className="app-shell">
      <ThemeCreator
        start={start}
        initialStep={step}
        initialMode={mode}
        close={() => {
          window.location.search = "?preview=appearance";
        }}
      />
    </div>
  );
}
