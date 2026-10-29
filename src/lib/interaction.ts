import type { InterfaceTheme } from "./types";

/**
 * Selection interaction model.
 *
 * The interface theme is the application's existing interaction-mode switch:
 * the Windows 11 theme behaves like File Explorer (Ctrl-based selection), and
 * the Finder theme behaves like macOS Finder (Command-based selection).
 *
 * Keeping this in one place is important on macOS: a Control-click is
 * interpreted by WebKit as a secondary click and emits `contextmenu`. Windows
 * mode therefore has to deliberately treat a primary Control-click as a
 * selection gesture and suppress the synthetic context menu.
 */
export type SelectionModifier = "ctrl" | "meta";

export interface ModifierEvent {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type SelectionIntent = "replace" | "toggle" | "range";

export interface SelectionIntentOptions {
  /** The active interface theme, not the operating system. */
  interfaceTheme: InterfaceTheme;
  /**
   * Finder's Control-click is native secondary-click behaviour. Windows mode
   * additionally accepts Command as a compatibility alias for macOS users.
   */
  allowMetaInWindowsMode?: boolean;
}

export function selectionModifierFor(interfaceTheme: InterfaceTheme): SelectionModifier {
  return interfaceTheme === "finder" ? "meta" : "ctrl";
}

/** True when the event carries the additive selection modifier for the mode. */
export function hasAdditiveSelectionModifier(
  event: Pick<ModifierEvent, "ctrlKey" | "metaKey">,
  interfaceTheme: InterfaceTheme,
  options: SelectionIntentOptions = { interfaceTheme },
): boolean {
  if (interfaceTheme === "finder") return event.metaKey;
  const allowMeta = options.allowMetaInWindowsMode ?? true;
  return event.ctrlKey || (allowMeta && event.metaKey);
}

/**
 * Resolve a pointer gesture into the selection operation it should perform.
 * Shift always wins so Ctrl/Command + Shift + click extends a range additively.
 */
export function selectionIntent(
  event: ModifierEvent,
  interfaceTheme: InterfaceTheme,
): SelectionIntent {
  if (event.shiftKey) return "range";
  if (hasAdditiveSelectionModifier(event, interfaceTheme)) return "toggle";
  return "replace";
}

/**
 * A Control-click on macOS produces a `contextmenu` event with `button === 0`
 * (a real secondary click has `button === 2`). In Windows mode that gesture is
 * a selection click, not a request for a menu.
 */
export function isSelectionContextMenuGesture(
  event: Pick<ModifierEvent, "button" | "ctrlKey">,
  interfaceTheme: InterfaceTheme,
): boolean {
  return interfaceTheme === "windows" && event.button === 0 && event.ctrlKey;
}

/** Select-all follows the active interaction mode (Ctrl+A / Command+A). */
export function hasSelectAllModifier(
  event: Pick<ModifierEvent, "ctrlKey" | "metaKey">,
  interfaceTheme: InterfaceTheme,
): boolean {
  return selectionModifierFor(interfaceTheme) === "meta"
    ? event.metaKey
    : event.ctrlKey || event.metaKey;
}
