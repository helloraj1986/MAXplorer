import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { FileTypeIcon } from "./icons/FileTypeIcon";
import { IndexingDashboard } from "./search/IndexingDashboard";
import { AppearanceSettings } from "./appearance/AppearanceSettings";
import { ThemeCreator } from "./appearance/ThemeCreator";
import { useExplorerStore } from "../state/explorerStore";
import { api, normalizeError } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { formatDate, formatSize, typeName } from "../lib/format";
import type {
  DialogState,
  FolderOpenMode,
  SettingsSection,
  UiDensity,
  UiIconSize,
  UiTextSize,
  ViewMode,
} from "../lib/types";
import { DEFAULT_DISPLAY_PREFERENCES } from "../lib/theme";
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
      width={860}
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
    case "themeCreator":
      return <ThemeCreator start={dialog.start} close={close} />;
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
