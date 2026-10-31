import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { installGlobalDiagnostics } from "./lib/diagnostics";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/finder.css";
import "./styles/search.css";
import "./styles/storage.css";
import "./styles/appearance.css";
import { loadPersisted, loadThemePreferences } from "./lib/persistence";
import { applyDisplayAttributes, applyThemeAttributes, themeAttributes } from "./lib/theme";
import { activeThemeFor, iconPackForTheme, useAppearanceStore } from "./state/appearanceStore";
import { applyIconPack, applyThemeDesign } from "./lib/appearance/tokens";

// Apply the persisted theme pair before React renders. `index.html` also runs a
// tiny inline bootstrap so even the first stylesheet paint is correct; this call
// covers environments where that inline script did not run.
const preferences = loadThemePreferences();
const prefersDark =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-color-scheme: dark)").matches;
applyThemeAttributes(themeAttributes(preferences.interfaceTheme, preferences.theme, prefersDark));
const persisted = loadPersisted();
if (persisted) applyDisplayAttributes(persisted.display);

// Apply a custom design and icon pack before React renders. This mirrors the
// useTheme hook so a saved custom theme appears on the first frame.
const appearanceState = useAppearanceStore.getState();
const savedDesign = activeThemeFor(appearanceState);
const savedPack = iconPackForTheme(appearanceState, savedDesign);
if (savedDesign) {
  applyThemeDesign(savedDesign, savedPack);
} else {
  applyIconPack(savedPack);
}

installGlobalDiagnostics();
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const preview = new URLSearchParams(window.location.search).get("preview");
if (import.meta.env.DEV && preview === "appearance") {
  void import("./dev/AppearancePreview").then(({ AppearancePreview }) => {
    root.render(<AppearancePreview />);
  });
} else if (import.meta.env.DEV && preview === "dual-pane") {
  void import("./dev/DualPanePreview").then(({ DualPanePreview }) => {
    root.render(<DualPanePreview />);
  });
} else {
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
