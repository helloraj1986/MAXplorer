import { useEffect, useState } from "react";
import { useExplorerStore } from "../state/explorerStore";

export function useTheme(): "light" | "dark" {
  const theme = useExplorerStore((state) => state.theme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = theme === "system" ? (query.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      setResolved(next);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  return resolved;
}
