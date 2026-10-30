import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/finder.css";
import "./styles/search.css";
import { loadPersisted, loadThemePreferences } from "./lib/persistence";
import { applyDisplayAttributes, applyThemeAttributes, themeAttributes } from "./lib/theme";

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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
