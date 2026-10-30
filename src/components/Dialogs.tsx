import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { FileTypeIcon } from "./icons/FileTypeIcon";
import { IndexingDashboard } from "./search/IndexingDashboard";
import { useExplorerStore } from "../state/explorerStore";
import { api, normalizeError } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatDate, formatSize, typeName } from "../lib/format";
import type {
  DialogState,
  FolderOpenMode,
  InterfaceTheme,
  SettingsSection,
  ThemeMode,
  UiDensity,
  UiIconSize,
  UiTextSize,
  ViewMode,
} from "../lib/types";
import { DEFAULT_DISPLAY_PREFERENCES, INTERFACE_THEME_DEFINITIONS, INTERFACE_THEMES } from "../lib/theme";
import {
  APP_ICON_URL,
  APP_VERSION,
  BRAND_STATEMENT,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
  TAGLINE,
} from "../lib/branding";

function Modal({
  title,
  icon,
  width = 460,
  onClose,
  children,
  footer,
}: {
  title: string;
  icon?: ReactNode;
  width?: number;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      "input, button, select, textarea, [href], [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "input, button, select, textarea, [href], [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        className="modal"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
      >
        <div className="modal-titlebar">
          {icon ? <span className="modal-icon">{icon}</span> : null}
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={11} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

function ConfirmDialog({ dialog, close }: { dialog: Extract<DialogState, { kind: "confirm" }>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await dialog.onConfirm();
      close();
    } catch (error) {
      useExplorerStore.getState().toastError(error);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={dialog.title}
      icon={<Icon name={dialog.destructive ? "warning" : "info"} size={20} />}
      onClose={close}
      footer={
        <>
          <button type="button" className="dialog-button" onClick={close} disabled={busy}>
            {dialog.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            className={`dialog-button ${dialog.destructive ? "danger" : "primary"}`}
            onClick={() => void run()}
            disabled={busy}
          >
            {busy ? "Working..." : dialog.confirmLabel}
          </button>
        </>
      }
    >
      <p className="dialog-message">{dialog.message}</p>
      {dialog.detail ? <p className="dialog-detail">{dialog.detail}</p> : null}
    </Modal>
  );
}

function PromptDialog({ dialog, close }: { dialog: Extract<DialogState, { kind: "prompt" }>; close: () => void }) {
  const [value, setValue] = useState(dialog.initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (dialog.selectStem) {
      const dot = dialog.initialValue.lastIndexOf(".");
      if (dot > 0) input.setSelectionRange(0, dot);
      else input.select();
    } else {
      input.select();
    }
  }, [dialog.initialValue, dialog.selectStem]);

  const submit = async () => {
    if (!value.trim()) {
      setError("Enter a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await dialog.onConfirm(value);
      close();
    } catch (cause) {
      setError(normalizeError(cause).message);
      setBusy(false);
      window.setTimeout(() => inputRef.current?.select(), 0);
    }
  };

  return (
    <Modal
      title={dialog.title}
      onClose={close}
      footer={
        <>
          <button type="button" className="dialog-button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="dialog-button primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Working..." : dialog.confirmLabel}
          </button>
        </>
      }
    >
      <label className="dialog-field">
        <span>{dialog.label}</span>
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </label>
      {error ? <p className="dialog-error">{error}</p> : null}
    </Modal>
  );
}

function ConflictDialog({ dialog, close }: { dialog: Extract<DialogState, { kind: "conflict" }>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const choose = async (policy: "replace" | "rename" | "skip" | "error") => {
    if (policy === "error") {
      close();
      return;
    }
    setBusy(true);
    try {
      await dialog.onChoose(policy);
      close();
    } catch (error) {
      useExplorerStore.getState().toastError(error);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={dialog.title}
      icon={<Icon name="warning" size={22} />}
      onClose={close}
      footer={
        <>
          <button type="button" className="dialog-button" onClick={() => void choose("error")} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="dialog-button" onClick={() => void choose("skip")} disabled={busy}>
            Skip
          </button>
          <button type="button" className="dialog-button" onClick={() => void choose("rename")} disabled={busy}>
            Keep both
          </button>
          <button type="button" className="dialog-button primary" onClick={() => void choose("replace")} disabled={busy}>
            {busy ? "Working..." : "Replace"}
          </button>
        </>
      }
    >
      <p className="dialog-message">{dialog.message}</p>
      {dialog.destination ? (
        <p className="conflict-destination">
          Destination: <code>{dialog.destination}</code>
        </p>
      ) : null}
      <div className="conflict-list">
        {dialog.conflicts.slice(0, 8).map((name) => (
          <div className="conflict-row" key={name}>
            <Icon name="file" size={16} />
            <span>{name}</span>
          </div>
        ))}
        {dialog.conflicts.length > 8 ? (
          <div className="conflict-row muted">and {dialog.conflicts.length - 8} more</div>
        ) : null}
      </div>
    </Modal>
  );
}

function PropertiesDialog({ dialog, close }: { dialog: Extract<DialogState, { kind: "properties" }>; close: () => void }) {
  const properties = dialog.properties;
  const stats = dialog.stats;
  return (
    <Modal
      title="Properties"
      width={560}
      icon={<Icon name="properties" size={20} />}
      onClose={close}
      footer={
        <>
          <button
            type="button"
            className="dialog-button"
            onClick={async () => {
              const ok = await copyTextToClipboard(dialog.path);
              useExplorerStore.getState().toast({
                title: ok ? "Path copied" : "Couldn't copy the path",
                tone: ok ? "success" : "error",
              });
            }}
          >
            Copy path
          </button>
          <button type="button" className="dialog-button primary" onClick={close}>
            Close
          </button>
        </>
      }
    >
      {dialog.loading ? (
        <div className="properties-loading">
          <Icon name="spinner" size={18} className="spin" />
          Reading properties...
        </div>
      ) : dialog.error ? (
        <p className="dialog-error">{dialog.error}</p>
      ) : properties ? (
        <div className="properties">
          <div className="properties-heading">
            <FileTypeIcon entry={{
              name: properties.name,
              path: properties.path,
              isDir: properties.isDir,
              isSymlink: properties.isSymlink,
              size: properties.size,
              modified: properties.modified,
              created: properties.created,
              accessed: properties.accessed,
              extension: properties.extension,
              isHidden: properties.isHidden,
              isReadOnly: properties.isReadOnly,
              target: properties.target,
            }} size={56} thumbnail />
            <div>
              <div className="properties-name">{properties.name}</div>
              <div className="properties-type">{properties.isDir ? "File folder" : typeName({
                name: properties.name,
                path: properties.path,
                isDir: properties.isDir,
                isSymlink: properties.isSymlink,
                size: properties.size,
                modified: properties.modified,
                created: properties.created,
                accessed: properties.accessed,
                extension: properties.extension,
                isHidden: properties.isHidden,
                isReadOnly: properties.isReadOnly,
                target: properties.target,
              })}</div>
            </div>
          </div>
          <div className="properties-tabs" role="tablist">
            <button type="button" className="properties-tab active" role="tab" aria-selected="true">
              General
            </button>
          </div>
          <div className="properties-grid">
            <span>Location</span>
            <span className="properties-value" title={properties.path}>{properties.path}</span>
            <span>Size</span>
            <span>{properties.isDir ? (stats ? formatSize(stats.totalSize) : "Calculating...") : formatSize(properties.size)}</span>
            {properties.isDir ? (
              <>
                <span>Contains</span>
                <span>
                  {stats
                    ? `${stats.files.toLocaleString()} Files, ${stats.folders.toLocaleString()} Folders`
                    : properties.itemCount != null
                      ? `${properties.itemCount.toLocaleString()} items`
                      : "Calculating..."}
                  {stats?.truncated ? " (partial)" : ""}
                </span>
              </>
            ) : null}
            <span>Date created</span>
            <span>{formatDate(properties.created)}</span>
            <span>Date modified</span>
            <span>{formatDate(properties.modified)}</span>
            <span>Accessed</span>
            <span>{formatDate(properties.accessed)}</span>
            <span>Permissions</span>
            <span>{properties.permissions}</span>
            {properties.ownerId != null ? (
              <>
                <span>Owner ID</span>
                <span>{properties.ownerId}</span>
              </>
            ) : null}
            {properties.groupId != null ? (
              <>
                <span>Group ID</span>
                <span>{properties.groupId}</span>
              </>
            ) : null}
            {properties.isSymlink && properties.target ? (
              <>
                <span>Target</span>
                <span className="properties-value" title={properties.target}>{properties.target}</span>
              </>
            ) : null}
            <span>Attributes</span>
            <span>
              {properties.isHidden ? "Hidden" : "Visible"}
              {properties.isReadOnly ? ", Read-only" : ""}
            </span>
          </div>
          {stats?.truncated ? (
            <p className="dialog-detail">Folder size was computed from a partial scan.</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function OpenWithDialog({ dialog, close }: { dialog: Extract<DialogState, { kind: "openWith" }>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const open = async (app: string) => {
    setBusy(true);
    try {
      await api.openWith(app, dialog.path);
      close();
    } catch (error) {
      useExplorerStore.getState().toastError(error);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Open with"
      width={480}
      onClose={close}
      footer={
        <>
          <button type="button" className="dialog-button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="dialog-button primary"
            disabled={busy}
            onClick={async () => {
              try {
                await api.openPath(dialog.path);
                close();
              } catch (error) {
                useExplorerStore.getState().toastError(error);
              }
            }}
          >
            Default app
          </button>
        </>
      }
    >
      <p className="dialog-path" title={dialog.path}>{dialog.path}</p>
      {dialog.loading ? (
        <div className="properties-loading">
          <Icon name="spinner" size={18} className="spin" />
          Finding applications...
        </div>
      ) : dialog.applications.length ? (
        <div className="app-list">
          {dialog.applications.map((application) => (
            <button
              type="button"
              className="app-row"
              key={application.path}
              onClick={() => void open(application.path)}
              disabled={busy}
            >
              <span className="app-icon">
                <Icon name="applications" size={22} />
              </span>
              <span>{application.name}</span>
              <Icon name="chevronRight" size={12} />
            </button>
          ))}
        </div>
      ) : (
        <p className="dialog-detail">
          No applications were found in /Applications. Use the default app or open the item in Finder.
        </p>
      )}
    </Modal>
  );
}

function WindowsPreview() {
  return (
    <svg viewBox="0 0 200 120" role="img" aria-label="Miniature of the Windows 11 Explorer layout">
      <rect width="200" height="120" rx="6" fill="#e9eef5" />
      <rect x="1" y="1" width="198" height="118" rx="5" fill="#ffffff" />
      <rect x="1" y="1" width="198" height="16" rx="5" fill="#f3f3f3" />
      <rect x="1" y="13" width="198" height="4" fill="#f3f3f3" />
      <rect x="10" y="4" width="34" height="12" rx="4" fill="#ffffff" />
      <rect x="14" y="8" width="4" height="4" rx="1" fill="#e8b23a" />
      <rect x="21" y="8" width="14" height="3" rx="1.5" fill="#9aa4ad" />
      <rect x="48" y="6" width="10" height="8" rx="2" fill="#e4e8ec" />
      <rect x="1" y="17" width="198" height="15" fill="#f7f9fb" />
      <circle cx="13" cy="24.5" r="3.2" fill="#0067c0" />
      <rect x="20" y="22" width="14" height="4" rx="2" fill="#5c6670" />
      <rect x="42" y="22" width="4" height="5" rx="1" fill="#8b959e" />
      <rect x="50" y="22" width="4" height="5" rx="1" fill="#8b959e" />
      <rect x="58" y="22" width="4" height="5" rx="1" fill="#8b959e" />
      <rect x="68" y="21" width="58" height="7" rx="3" fill="#ffffff" stroke="#c9d2db" />
      <rect x="132" y="21" width="38" height="7" rx="3" fill="#ffffff" stroke="#c9d2db" />
      <rect x="1" y="32" width="198" height="18" fill="#ffffff" />
      <circle cx="13" cy="41" r="4" fill="#eef2f6" stroke="#9aa4ad" strokeWidth=".8" />
      <rect x="22" y="37" width="5" height="5" rx="1" fill="#7b8790" />
      <rect x="30" y="37" width="5" height="5" rx="1" fill="#7b8790" />
      <rect x="38" y="37" width="5" height="5" rx="1" fill="#7b8790" />
      <rect x="50" y="36.5" width="118" height="9" rx="3" fill="#fbfcfd" stroke="#d6dde4" />
      <rect x="56" y="39.5" width="24" height="3" rx="1.5" fill="#8b959e" />
      <rect x="172" y="36.5" width="40" height="9" rx="3" fill="#fbfcfd" stroke="#d6dde4" />
      <rect x="1" y="50" width="56" height="69" fill="#f3f6f9" />
      <rect x="8" y="57" width="24" height="3" rx="1.5" fill="#a7b0b8" />
      {[66, 78, 90, 102].map((y) => (
        <g key={y}>
          <rect x="8" y={y} width="5" height="5" rx="1" fill="#2f9be8" />
          <rect x="17" y={y + 1} width="24" height="3" rx="1.5" fill="#7b8790" />
        </g>
      ))}
      <rect x="57" y="50" width="142" height="10" fill="#f7f9fb" />
      <rect x="63" y="54" width="30" height="3" rx="1.5" fill="#a7b0b8" />
      <rect x="120" y="54" width="22" height="3" rx="1.5" fill="#a7b0b8" />
      <rect x="164" y="54" width="18" height="3" rx="1.5" fill="#a7b0b8" />
      {[64, 76, 88, 100, 112].map((y) => (
        <g key={y}>
          <rect x="63" y={y + 1} width="4" height="4" rx="1" fill="#e8b23a" />
          <rect x="72" y={y + 2} width="46" height="3" rx="1.5" fill="#7b8790" />
          <rect x="124" y={y + 2} width="20" height="3" rx="1.5" fill="#c3cbd2" />
          <rect x="166" y={y + 2} width="16" height="3" rx="1.5" fill="#c3cbd2" />
        </g>
      ))}
      <rect x="63" y="76" width="119" height="10" rx="2" fill="#e8f2fb" />
    </svg>
  );
}

function FinderPreview() {
  return (
    <svg viewBox="0 0 200 120" role="img" aria-label="Miniature of the macOS Finder layout">
      <rect width="200" height="120" rx="6" fill="#dfe3ea" />
      <rect x="1" y="1" width="198" height="118" rx="5" fill="#ffffff" />
      <rect x="1" y="1" width="198" height="22" rx="5" fill="#ececee" />
      <rect x="1" y="17" width="198" height="6" fill="#ececee" />
      <circle cx="12" cy="9" r="3" fill="#ff5f57" />
      <circle cx="22" cy="9" r="3" fill="#febc2e" />
      <circle cx="32" cy="9" r="3" fill="#28c840" />
      <rect x="64" y="5" width="34" height="9" rx="3" fill="#ffffff" stroke="#d5d5d8" />
      <rect x="70" y="8" width="18" height="3" rx="1.5" fill="#8a8a8e" />
      <rect x="1" y="23" width="198" height="19" fill="#f7f7f9" />
      <path d="M13 33.5 9 30l4-3.5" fill="none" stroke="#6f7276" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19 26.5 4 3.5-4 3.5" fill="none" stroke="#b6b8bb" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="32" y="28" width="48" height="4" rx="2" fill="#6f7276" />
      <rect x="120" y="26" width="46" height="9" rx="4.5" fill="#ffffff" stroke="#d5d5d8" />
      <circle cx="127" cy="30.5" r="2" fill="none" stroke="#9a9da1" strokeWidth="1" />
      <rect x="170" y="26" width="9" height="9" rx="3" fill="#ffffff" stroke="#d5d5d8" />
      <rect x="182" y="26" width="9" height="9" rx="3" fill="#ffffff" stroke="#d5d5d8" />
      <rect x="1" y="42" width="62" height="77" fill="#f2f2f5" />
      <rect x="8" y="48" width="20" height="3" rx="1.5" fill="#a4a6aa" />
      {[
        { y: 57, color: "#4a9cf5" },
        { y: 68, color: "#f0a13a" },
        { y: 79, color: "#58c26a" },
      ].map((row) => (
        <g key={row.y}>
          <rect x="8" y={row.y} width="6" height="6" rx="1.4" fill={row.color} />
          <rect x="18" y={row.y + 1.5} width="26" height="3" rx="1.5" fill="#7b7d81" />
        </g>
      ))}
      <rect x="8" y="93" width="18" height="3" rx="1.5" fill="#a4a6aa" />
      {[
        { y: 101, color: "#8e8e93" },
        { y: 111, color: "#8e8e93" },
      ].map((row) => (
        <g key={row.y}>
          <rect x="8" y={row.y} width="6" height="6" rx="1.4" fill={row.color} />
          <rect x="18" y={row.y + 1.5} width="22" height="3" rx="1.5" fill="#7b7d81" />
        </g>
      ))}
      <rect x="63" y="42" width="136" height="12" fill="#fbfbfc" />
      <rect x="70" y="47" width="32" height="3" rx="1.5" fill="#a4a6aa" />
      <rect x="118" y="47" width="24" height="3" rx="1.5" fill="#a4a6aa" />
      <rect x="160" y="47" width="20" height="3" rx="1.5" fill="#a4a6aa" />
      {[58, 70, 82, 94, 106].map((y, index) => (
        <g key={y}>
          <rect x="63" y={y} width="136" height="11" rx="2" fill={index === 1 ? "#d9e7fb" : "transparent"} />
          <rect x="70" y={y + 3} width="5" height="5" rx="1.2" fill="#4a9cf5" />
          <rect x="80" y={y + 4} width="48" height="3" rx="1.5" fill="#6f7276" />
          <rect x="132" y={y + 4} width="22" height="3" rx="1.5" fill="#c3c5c9" />
          <rect x="162" y={y + 4} width="18" height="3" rx="1.5" fill="#c3c5c9" />
        </g>
      ))}
    </svg>
  );
}

function ThemePreview({ theme }: { theme: InterfaceTheme }) {
  return (
    <span className={`theme-preview ${theme}`} aria-hidden="true">
      {theme === "finder" ? <FinderPreview /> : <WindowsPreview />}
    </span>
  );
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: "palette" | "view" | "columns" | "settings" | "info" | "database" }> = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "display", label: "Display", icon: "view" },
  { id: "layout", label: "Layout", icon: "columns" },
  { id: "behavior", label: "Behavior", icon: "settings" },
  { id: "keyboard", label: "Keyboard", icon: "info" },
  { id: "advanced", label: "Advanced", icon: "database" },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-field">
      <span className="settings-field-label">{label}</span>
      <div className="appearance-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`appearance-option ${value === option.value ? "active" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AppearanceSettings() {
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const setInterfaceTheme = useExplorerStore((state) => state.setInterfaceTheme);
  const theme = useExplorerStore((state) => state.theme);
  const setTheme = useExplorerStore((state) => state.setTheme);

  return (
    <div className="themes">
      <section className="themes-section" aria-labelledby="interface-theme-heading">
        <h3 id="interface-theme-heading">Interface theme</h3>
        <p className="themes-hint">
          Choose how the window looks. Both themes use the same files, tabs, and commands.
        </p>
        <div className="theme-grid" role="group" aria-labelledby="interface-theme-heading">
          {INTERFACE_THEMES.map((id) => {
            const definition = INTERFACE_THEME_DEFINITIONS[id];
            const active = interfaceTheme === id;
            return (
              <button
                type="button"
                key={id}
                className={`theme-card ${active ? "active" : ""}`}
                aria-pressed={active}
                aria-label={`${definition.name}${active ? " (active theme)" : ""}`}
                onClick={() => setInterfaceTheme(id)}
              >
                <ThemePreview theme={id} />
                <span className="theme-card-head">
                  <span className="theme-card-name">{definition.name}</span>
                  {active ? (
                    <span className="theme-card-badge">
                      <Icon name="check" size={11} />
                      Active
                    </span>
                  ) : null}
                </span>
                <span className="theme-card-description">{definition.description}</span>
                <span className={`theme-card-action ${active ? "applied" : ""}`}>
                  {active ? "Applied" : "Apply theme"}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="themes-section" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading">Light and dark</h3>
        <p className="themes-hint">
          Appearance is independent from the interface theme. Both themes support both settings.
        </p>
        <div className="appearance-segmented" role="group" aria-label="Appearance">
          {(
            [
              { value: "system", label: "Use system setting" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ] as Array<{ value: ThemeMode; label: string }>
          ).map((option) => (
            <button
              type="button"
              key={option.value}
              className={`appearance-option ${theme === option.value ? "active" : ""}`}
              aria-pressed={theme === option.value}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function DisplaySettings() {
  const display = useExplorerStore((state) => state.display);
  const setDensity = useExplorerStore((state) => state.setDensity);
  const setTextSize = useExplorerStore((state) => state.setTextSize);
  const setIconSize = useExplorerStore((state) => state.setIconSize);
  const activePane = useExplorerStore((state) => state.activePane);
  const viewMode = useExplorerStore((state) => state.panes[state.activePane].viewMode);
  const setViewMode = useExplorerStore((state) => state.setViewMode);

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h3>Text and icon size</h3>
        <p className="settings-hint">
          Scaling applies immediately to the toolbar, navigation, tabs, menus, and file views.
        </p>
        <Segmented<UiTextSize>
          label="Text size"
          value={display.textSize}
          options={[
            { value: "small", label: "Small" },
            { value: "default", label: "Default" },
            { value: "large", label: "Large" },
          ]}
          onChange={setTextSize}
        />
        <Segmented<UiIconSize>
          label="Icon size"
          value={display.iconSize}
          options={[
            { value: "small", label: "Small" },
            { value: "default", label: "Default" },
            { value: "large", label: "Large" },
          ]}
          onChange={setIconSize}
        />
        <Segmented<UiDensity>
          label="Row density and spacing"
          value={display.density}
          options={[
            { value: "comfortable", label: "Comfortable" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={setDensity}
        />
      </section>
      <section className="settings-section">
        <h3>Default view</h3>
        <p className="settings-hint">
          Applies to the active pane. Each pane keeps its own view when you switch panes or tabs.
        </p>
        <select
          className="settings-select"
          value={viewMode}
          aria-label="Default view"
          onChange={(event) => setViewMode(event.target.value as ViewMode, activePane)}
        >
          <option value="details">Details</option>
          <option value="list">List</option>
          <option value="large">Large icons</option>
          <option value="medium">Medium icons</option>
          <option value="small">Small icons</option>
          <option value="extraLarge">Extra large icons</option>
          <option value="tiles">Tiles</option>
          <option value="content">Content</option>
        </select>
      </section>
    </div>
  );
}

function LayoutSettings() {
  const sidebarVisible = useExplorerStore((state) => state.sidebarVisible);
  const setSidebarVisible = useExplorerStore((state) => state.setSidebarVisible);
  const commandBarLabels = useExplorerStore((state) => state.commandBarLabels);
  const setCommandBarLabels = useExplorerStore((state) => state.setCommandBarLabels);
  const setSidebarWidth = useExplorerStore((state) => state.setSidebarWidth);
  const setSplitRatio = useExplorerStore((state) => state.setSplitRatio);

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h3>Workspace</h3>
        <label className="check-row">
          <input type="checkbox" checked={sidebarVisible} onChange={(event) => setSidebarVisible(event.target.checked)} />
          <span>Show navigation pane</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={commandBarLabels} onChange={(event) => setCommandBarLabels(event.target.checked)} />
          <span>Show text labels in the command bar</span>
        </label>
        <div className="settings-actions">
          <button type="button" className="dialog-button" onClick={() => setSidebarWidth(204)}>
            Reset navigation pane width
          </button>
          <button type="button" className="dialog-button" onClick={() => setSplitRatio(0.5)}>
            Reset pane split
          </button>
        </div>
      </section>
    </div>
  );
}

function BehaviorSettings() {
  const folderOpenMode = useExplorerStore((state) => state.folderOpenMode);
  const setFolderOpenMode = useExplorerStore((state) => state.setFolderOpenMode);
  const confirmTrashDelete = useExplorerStore((state) => state.confirmTrashDelete);
  const setConfirmTrashDelete = useExplorerStore((state) => state.setConfirmTrashDelete);

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h3>Opening folders</h3>
        <p className="settings-hint">
          Double-clicking a folder in the active pane can replace the current tab or open a new one.
        </p>
        <label className="settings-field settings-select-field">
          <span className="settings-field-label">Open folders in</span>
          <select
            className="settings-select"
            value={folderOpenMode}
            onChange={(event) => setFolderOpenMode(event.target.value as FolderOpenMode)}
          >
            <option value="sameTab">The current tab</option>
            <option value="newTab">A new tab</option>
          </select>
        </label>
      </section>
      <section className="settings-section">
        <h3>Confirmations</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={confirmTrashDelete}
            onChange={(event) => setConfirmTrashDelete(event.target.checked)}
          />
          <span>Confirm before moving items to the Trash</span>
        </label>
        <p className="settings-hint">
          Permanent deletion always asks for confirmation, regardless of this setting.
        </p>
      </section>
    </div>
  );
}

function KeyboardSettings() {
  const shortcuts = useExplorerStore((state) => state.shortcuts);
  const platform = useExplorerStore((state) => state.platform);
  const setShortcut = useExplorerStore((state) => state.setShortcut);
  const resetShortcuts = useExplorerStore((state) => state.resetShortcuts);
  const mod = platform?.modifier === "cmd" ? "Cmd" : "Ctrl";
  const shortcutRows: Array<{ key: keyof typeof shortcuts; label: string }> = [
    { key: "toggleDualPane", label: "Toggle dual-pane mode" },
    { key: "copyToOtherPane", label: "Copy to other pane" },
    { key: "moveToOtherPane", label: "Move to other pane" },
    { key: "switchPane", label: "Switch active pane" },
    { key: "globalSearch", label: "Open Universal Search" },
  ];
  const rows = [
    [`${mod}+T`, "New tab"],
    [`${mod}+W`, "Close tab"],
    [`${mod}+Tab`, "Next tab"],
    [`${mod}+Shift+Tab`, "Previous tab"],
    [`${mod}+,`, "Open Settings"],
    [`${mod}+L`, "Focus address bar"],
    [`${mod}+F`, "Focus search"],
    [`${mod}+B`, "Show or hide the navigation pane"],
    [`${mod}+A`, "Select all"],
    [`${mod}+C`, "Copy"],
    [`${mod}+X`, "Cut"],
    [`${mod}+V`, "Paste"],
    [`${mod}+Shift+N`, "New folder"],
    [`${mod}+Shift+C`, "Copy as path"],
    ["F2", "Rename"],
    ["F5", "Refresh"],
    ["Delete", "Move to Trash"],
    ["Shift+Delete", "Delete permanently"],
    ["Alt+Enter", "Properties"],
    ["Alt+Left / Alt+Right", "Back / Forward"],
    ["Alt+Up", "Up one level"],
    ["Alt+P / Alt+Shift+P", "Preview / Details pane"],
    [`${mod}+Shift+1...8`, "Switch view"],
    ["Home / End", "First / Last item"],
    ["Type a name", "Select matching item"],
  ];

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h3>Custom shortcuts</h3>
        <p className="settings-hint">
          Accelerators use Mod for {platform?.modifier === "cmd" ? "Command" : "Control"}. Changes apply immediately.
        </p>
        <div className="shortcut-settings">
          {shortcutRows.map((row) => (
            <label className="shortcut-setting" key={row.key}>
              <span>{row.label}</span>
              <input
                value={shortcuts[row.key]}
                spellCheck={false}
                onChange={(event) => setShortcut(row.key, event.target.value)}
              />
            </label>
          ))}
        </div>
        <button type="button" className="link-button" onClick={resetShortcuts}>
          Reset shortcuts
        </button>
      </section>
      <section className="settings-section">
        <h3>Shortcut reference</h3>
        <div className="shortcut-list">
          {rows.map(([keys, action]) => (
            <div className="shortcut-row" key={keys}>
              <kbd>{keys}</kbd>
              <span>{action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdvancedSettings() {
  const openDialog = useExplorerStore((state) => state.openDialog);
  const clearRecents = useExplorerStore((state) => state.clearRecents);
  const setInterfaceTheme = useExplorerStore((state) => state.setInterfaceTheme);
  const setDensity = useExplorerStore((state) => state.setDensity);
  const setTextSize = useExplorerStore((state) => state.setTextSize);
  const setIconSize = useExplorerStore((state) => state.setIconSize);
  const setCommandBarLabels = useExplorerStore((state) => state.setCommandBarLabels);
  const setSidebarVisible = useExplorerStore((state) => state.setSidebarVisible);

  return (
    <div className="settings-sections">
      <section className="settings-section">
        <h3>Search</h3>
        <button type="button" className="dialog-button" onClick={() => openDialog({ kind: "indexing" })}>
          <Icon name="database" size={14} />
          Indexed locations, content extraction, and diagnostics...
        </button>
        <p className="settings-hint">
          Universal Search runs locally. Content indexing covers supported text, PDF, and Office
          documents and can be paused at any time.
        </p>
      </section>
      <section className="settings-section">
        <h3>Privacy</h3>
        <button type="button" className="dialog-button" onClick={clearRecents}>
          Clear recent items
        </button>
      </section>
      <section className="settings-section">
        <h3>Reset</h3>
        <button
          type="button"
          className="dialog-button"
          onClick={() => {
            setDensity(DEFAULT_DISPLAY_PREFERENCES.density);
            setTextSize(DEFAULT_DISPLAY_PREFERENCES.textSize);
            setIconSize(DEFAULT_DISPLAY_PREFERENCES.iconSize);
            setCommandBarLabels(true);
            setSidebarVisible(true);
            setInterfaceTheme("windows");
          }}
        >
          Reset appearance and layout preferences
        </button>
        <p className="settings-hint">
          Resets display scaling, labels, navigation pane visibility, and the interface theme.
          Files, tabs, history, and selections are untouched.
        </p>
      </section>
    </div>
  );
}

function SettingsDialog({ initialSection = "appearance", close }: { initialSection?: SettingsSection; close: () => void }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  return (
    <Modal
      title="Settings"
      width={780}
      icon={<Icon name="settings" size={20} />}
      onClose={close}
      footer={
        <button type="button" className="dialog-button primary" onClick={close}>
          Close
        </button>
      }
    >
      <div className="settings-layout">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              type="button"
              key={item.id}
              role="tab"
              aria-selected={section === item.id}
              className={`settings-nav-item ${section === item.id ? "active" : ""}`}
              onClick={() => setSection(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-panel" role="tabpanel" aria-label={SETTINGS_SECTIONS.find((item) => item.id === section)?.label}>
          {section === "appearance" ? <AppearanceSettings /> : null}
          {section === "display" ? <DisplaySettings /> : null}
          {section === "layout" ? <LayoutSettings /> : null}
          {section === "behavior" ? <BehaviorSettings /> : null}
          {section === "keyboard" ? <KeyboardSettings /> : null}
          {section === "advanced" ? <AdvancedSettings /> : null}
        </div>
      </div>
    </Modal>
  );
}

function AboutDialog({ close }: { close: () => void }) {
  return (
    <Modal
      title={`About ${PRODUCT_NAME}`}
      width={500}
      icon={<img className="modal-app-icon" src={APP_ICON_URL} alt="" />}
      onClose={close}
      footer={<button type="button" className="dialog-button primary" onClick={close}>Close</button>}
    >
      <div className="about">
        <div className="about-brand">
          <img className="about-app-icon" src={APP_ICON_URL} alt={`${PRODUCT_NAME} icon`} />
          <div className="about-brand-copy">
            <h3>{PRODUCT_NAME}</h3>
            <p className="about-tagline">{TAGLINE}</p>
            <p className="about-version">Version {APP_VERSION}</p>
          </div>
        </div>
        <p>{PRODUCT_DESCRIPTION}</p>
        <p className="about-statement">{BRAND_STATEMENT}</p>
        <p className="muted">
          An independent desktop file manager for macOS. Not affiliated with, endorsed by, or
          sponsored by Microsoft or Apple. Windows and macOS are trademarks of their respective
          owners.
        </p>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useExplorerStore((state) => state.dialog);
  const close = useExplorerStore((state) => state.closeDialog);
  if (!dialog) return null;
  switch (dialog.kind) {
    case "confirm":
      return <ConfirmDialog dialog={dialog} close={close} />;
    case "prompt":
      return <PromptDialog dialog={dialog} close={close} />;
    case "conflict":
      return <ConflictDialog dialog={dialog} close={close} />;
    case "properties":
      return <PropertiesDialog dialog={dialog} close={close} />;
    case "openWith":
      return <OpenWithDialog dialog={dialog} close={close} />;
    case "settings":
      return <SettingsDialog initialSection={dialog.section} close={close} />;
    case "indexing":
      return (
        <Modal
          title="Search indexing"
          width={760}
          icon={<Icon name="database" size={20} />}
          onClose={close}
          footer={
            <button type="button" className="dialog-button primary" onClick={close}>
              Close
            </button>
          }
        >
          <IndexingDashboard />
        </Modal>
      );
    case "about":
      return <AboutDialog close={close} />;
    default:
      return null;
  }
}
