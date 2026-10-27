import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { FileGlyph } from "./FileGlyph";
import { useExplorerStore } from "../state/explorerStore";
import { api, normalizeError } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatDate, formatSize, typeName } from "../lib/format";
import type { DialogState, ThemeMode, ViewMode } from "../lib/types";

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
            <FileGlyph entry={{
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

function PreferencesDialog({ close }: { close: () => void }) {
  const theme = useExplorerStore((state) => state.theme);
  const viewMode = useExplorerStore((state) => state.viewMode);
  const showHidden = useExplorerStore((state) => state.showHidden);
  const showExtensions = useExplorerStore((state) => state.showExtensions);
  const detailsPane = useExplorerStore((state) => state.detailsPane);
  const previewPane = useExplorerStore((state) => state.previewPane);
  const setTheme = useExplorerStore((state) => state.setTheme);
  const setViewMode = useExplorerStore((state) => state.setViewMode);
  const setShowHidden = useExplorerStore((state) => state.setShowHidden);
  const setShowExtensions = useExplorerStore((state) => state.setShowExtensions);
  const setDetailsPane = useExplorerStore((state) => state.setDetailsPane);
  const setPreviewPane = useExplorerStore((state) => state.setPreviewPane);
  const clearRecents = useExplorerStore((state) => state.clearRecents);

  return (
    <Modal
      title="Options"
      width={500}
      icon={<Icon name="settings" size={20} />}
      onClose={close}
      footer={
        <button type="button" className="dialog-button primary" onClick={close}>
          Close
        </button>
      }
    >
      <div className="preferences">
        <section>
          <h3>Appearance</h3>
          <div className="theme-choice">
            {(["system", "light", "dark"] as ThemeMode[]).map((value) => (
              <button
                type="button"
                key={value}
                className={`theme-tile ${theme === value ? "active" : ""}`}
                onClick={() => {
                  setTheme(value);
                }}
              >
                <span className={`theme-swatch ${value}`} />
                <span>{value === "system" ? "Use system setting" : value[0].toUpperCase() + value.slice(1)}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Default view</h3>
          <select
            value={viewMode}
            onChange={(event) => {
              setViewMode(event.target.value as ViewMode);
            }}
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
        <section>
          <h3>Show</h3>
          <label className="check-row">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(event) => {
                void setShowHidden(event.target.checked);
              }}
            />
            <span>Hidden items</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={showExtensions}
              onChange={(event) => {
                setShowExtensions(event.target.checked);
              }}
            />
            <span>File name extensions</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={detailsPane}
              onChange={(event) => {
                setDetailsPane(event.target.checked);
              }}
            />
            <span>Details pane</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={previewPane}
              onChange={(event) => {
                setPreviewPane(event.target.checked);
              }}
            />
            <span>Preview pane</span>
          </label>
        </section>
        <section>
          <h3>Privacy</h3>
          <button
            type="button"
            className="dialog-button"
            onClick={() => {
              clearRecents();
            }}
          >
            Clear recent items
          </button>
        </section>
      </div>
    </Modal>
  );
}

function AboutDialog({ close }: { close: () => void }) {
  return (
    <Modal
      title="About Windows 11 Explorer"
      width={480}
      icon={<Icon name="folder" size={22} />}
      onClose={close}
      footer={<button type="button" className="dialog-button primary" onClick={close}>Close</button>}
    >
      <div className="about">
        <h3>Windows 11 Explorer for macOS</h3>
        <p>Version 0.1.0</p>
        <p>
          A high-fidelity, independently implemented recreation of the Windows 11 File Explorer
          interface. It browses the real macOS filesystem and never uses mock file data.
        </p>
        <p className="muted">
          Built with Tauri, Rust, React, and TypeScript. This project is not affiliated with,
          endorsed by, or sponsored by Microsoft. Windows is a trademark of Microsoft Corporation.
        </p>
      </div>
    </Modal>
  );
}

function ShortcutsDialog({ close }: { close: () => void }) {
  const platform = useExplorerStore((state) => state.platform);
  const mod = platform?.modifier === "cmd" ? "Cmd" : "Ctrl";
  const rows = [
    [`${mod}+T`, "New tab"],
    [`${mod}+W`, "Close tab"],
    [`${mod}+Tab`, "Next tab"],
    [`${mod}+Shift+Tab`, "Previous tab"],
    [`${mod}+L`, "Focus address bar"],
    [`${mod}+F`, "Focus search"],
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
    <Modal
      title="Keyboard shortcuts"
      width={520}
      icon={<Icon name="info" size={20} />}
      onClose={close}
      footer={<button type="button" className="dialog-button primary" onClick={close}>Close</button>}
    >
      <div className="shortcut-list">
        {rows.map(([keys, action]) => (
          <div className="shortcut-row" key={keys}>
            <kbd>{keys}</kbd>
            <span>{action}</span>
          </div>
        ))}
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
    case "preferences":
      return <PreferencesDialog close={close} />;
    case "about":
      return <AboutDialog close={close} />;
    case "shortcuts":
      return <ShortcutsDialog close={close} />;
    default:
      return null;
  }
}
