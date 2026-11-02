import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  DEFAULT_TAG_COLOR,
  TAG_COLOR_PRESETS,
  normalizeTagColor,
  normalizeTagName,
  tagPathKey,
} from "../lib/tags";
import {
  networkAddressHasShare,
  networkAddressUsername,
  networkDisplayName,
  normalizeNetworkAddress,
  withNetworkUsername,
} from "../lib/network";
import type {
  DialogState,
  FolderOpenMode,
  SettingsSection,
  StorageAudit,
  StorageCleanupResult,
  TagDefinition,
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

function tagChipLabel(tag: TagDefinition): string {
  return tag.name;
}

function PropertiesTags({ path }: { path: string }) {
  const tags = useExplorerStore((state) => state.tags);
  const assignments = useExplorerStore((state) => state.tagAssignments);
  const toggleTag = useExplorerStore((state) => state.toggleTag);
  const openTagEditor = useExplorerStore((state) => state.openTagEditor);
  const assigned = useMemo(() => {
    const key = tagPathKey(path);
    return new Set(
      assignments.find((assignment) => tagPathKey(assignment.path) === key)?.tagIds ?? [],
    );
  }, [assignments, path]);

  if (!tags.length) {
    return (
      <div className="properties-tags">
        <div className="properties-tags-heading">
          <span>Tags</span>
          <button
            type="button"
            className="link-button"
            onClick={() => openTagEditor(undefined, [path])}
          >
            <Icon name="plus" size={12} />
            New Tag
          </button>
        </div>
        <p className="dialog-detail">
          No tags yet. Tags are {`MAXplorer`} metadata and never modify the file.
        </p>
      </div>
    );
  }

  return (
    <div className="properties-tags">
      <div className="properties-tags-heading">
        <span>Tags</span>
        <button
          type="button"
          className="link-button"
          onClick={() => openTagEditor(undefined, [path])}
        >
          <Icon name="plus" size={12} />
          New Tag
        </button>
      </div>
      <div className="properties-tag-list">
        {tags.map((tag) => {
          const active = assigned.has(tag.id);
          return (
            <button
              type="button"
              key={tag.id}
              className={`tag-chip ${active ? "active" : ""}`}
              aria-pressed={active}
              title={active ? `Remove ${tagChipLabel(tag)}` : `Add ${tagChipLabel(tag)}`}
              onClick={() => toggleTag([path], tag.id)}
            >
              <span
                className="tag-dot"
                style={{ backgroundColor: tag.color }}
                aria-hidden="true"
              />
              <span>{tagChipLabel(tag)}</span>
              <Icon name={active ? "check" : "plus"} size={11} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagEditorDialog({
  dialog,
  close,
}: {
  dialog: Extract<DialogState, { kind: "tagEditor" }>;
  close: () => void;
}) {
  const tags = useExplorerStore((state) => state.tags);
  const createTag = useExplorerStore((state) => state.createTag);
  const updateTag = useExplorerStore((state) => state.updateTag);
  const assignTag = useExplorerStore((state) => state.assignTag);
  const existing = dialog.tagId ? tags.find((tag) => tag.id === dialog.tagId) : undefined;
  const assignPaths = dialog.assignPaths ?? [];
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? DEFAULT_TAG_COLOR);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(existing?.name ?? "");
    setColor(existing?.color ?? DEFAULT_TAG_COLOR);
    setError(null);
  }, [existing?.color, existing?.id, existing?.name]);

  const submit = () => {
    const clean = normalizeTagName(name);
    if (!clean) {
      setError("Enter a tag name.");
      return;
    }
    const nextColor = normalizeTagColor(color);
    if (existing) {
      updateTag(existing.id, { name: clean, color: nextColor });
      if (assignPaths.length) assignTag(assignPaths, existing.id);
    } else {
      const id = createTag(clean, nextColor);
      if (!id) {
        setError("A tag with that name already exists.");
        return;
      }
      if (assignPaths.length) assignTag(assignPaths, id);
    }
    close();
  };

  const requestDelete = () => {
    if (!existing) return;
    close();
    useExplorerStore.getState().openDialog({
      kind: "confirm",
      title: `Delete the tag "${existing.name}"?`,
      message:
        "The tag is removed from every item that uses it. Files and folders are not deleted.",
      confirmLabel: "Delete Tag",
      destructive: true,
      onConfirm: () => useExplorerStore.getState().deleteTag(existing.id),
    });
  };

  return (
    <Modal
      title={existing ? "Rename Tag" : "New Tag"}
      width={460}
      icon={<Icon name="tag" size={20} />}
      onClose={close}
      footer={
        <>
          {existing ? (
            <button type="button" className="dialog-button danger" onClick={requestDelete}>
              Delete
            </button>
          ) : null}
          <button type="button" className="dialog-button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="dialog-button primary" onClick={submit}>
            {existing ? "Save" : "Create Tag"}
          </button>
        </>
      }
    >
      <label className="dialog-field">
        <span>Name</span>
        <input
          value={name}
          maxLength={40}
          spellCheck={false}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
      </label>
      <div className="dialog-field">
        <span>Color</span>
        <div className="tag-color-grid" role="group" aria-label="Tag color">
          {TAG_COLOR_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset}
              className={`tag-color-swatch ${normalizeTagColor(color) === preset ? "active" : ""}`}
              style={{ backgroundColor: preset }}
              aria-label={`Use color ${preset}`}
              aria-pressed={normalizeTagColor(color) === preset}
              onClick={() => setColor(preset)}
            />
          ))}
        </div>
        <div className="tag-color-custom">
          <input
            type="color"
            value={normalizeTagColor(color)}
            aria-label="Choose a custom tag color"
            onChange={(event) => setColor(event.target.value)}
          />
          <input
            value={color}
            spellCheck={false}
            aria-label="Tag color hex value"
            onChange={(event) => setColor(event.target.value)}
            onBlur={() => setColor(normalizeTagColor(color))}
          />
        </div>
      </div>
      {assignPaths.length ? (
        <p className="dialog-detail">
          Will be applied to {assignPaths.length}{" "}
          {assignPaths.length === 1 ? "selected item" : "selected items"}.
        </p>
      ) : null}
      {error ? <p className="dialog-error">{error}</p> : null}
    </Modal>
  );
}

function NetworkConnectionDialog({
  dialog,
  close,
}: {
  dialog: Extract<DialogState, { kind: "networkConnection" }>;
  close: () => void;
}) {
  const connections = useExplorerStore((state) => state.networkConnections);
  const saveNetworkConnection = useExplorerStore((state) => state.saveNetworkConnection);
  const existing = dialog.connectionId
    ? connections.find((connection) => connection.id === dialog.connectionId)
    : undefined;
  const [name, setName] = useState(
    existing?.name ?? dialog.initialName ?? "",
  );
  const [address, setAddress] = useState(
    existing?.address ?? dialog.initialAddress ?? "",
  );
  const [username, setUsername] = useState(
    existing ? networkAddressUsername(existing.address) : "",
  );
  const [password, setPassword] = useState("");
  const [shares, setShares] = useState<string[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesSearched, setSharesSearched] = useState(false);
  const [sharesError, setSharesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(existing?.name ?? dialog.initialName ?? "");
    setAddress(existing?.address ?? dialog.initialAddress ?? "");
    setUsername(existing ? networkAddressUsername(existing.address) : "");
    setPassword("");
    setShares([]);
    setSharesSearched(false);
    setSharesError(null);
    setError(null);
  }, [
    dialog.initialAddress,
    dialog.initialName,
    existing?.address,
    existing?.id,
    existing?.name,
  ]);

  const normalized = normalizeNetworkAddress(address);
  const canConnect = Boolean(normalized && networkAddressHasShare(normalized));

  const findShares = async () => {
    if (!normalized) {
      setError("Enter a server address such as smb://server.");
      return;
    }
    setSharesLoading(true);
    setSharesSearched(false);
    setSharesError(null);
    setError(null);
    try {
      setShares(await api.listNetworkShares(normalized, username, password));
      setSharesSearched(true);
    } catch (cause) {
      setSharesError(normalizeError(cause).message);
    } finally {
      setSharesLoading(false);
    }
  };

  const chooseShare = (share: string) => {
    const base = (normalized ?? address).replace(/\/+$/, "");
    setAddress(`${base}/${encodeURIComponent(share)}`);
    setShares([]);
    setSharesSearched(false);
    setSharesError(null);
  };

  const submit = (connect: boolean) => {
    if (!normalized) {
      setError("Enter a server address such as smb://server/share.");
      return;
    }
    // Persist the username as part of the address, but never the password.
    const id = saveNetworkConnection({
      id: existing?.id,
      name,
      address: withNetworkUsername(normalized, username),
      username,
      password,
    });
    close();
    if (connect) {
      void useExplorerStore.getState().connectNetworkConnection(id);
    }
  };

  return (
    <Modal
      title={existing ? "Edit Server" : "Connect to Server"}
      width={500}
      icon={<Icon name="network" size={20} />}
      onClose={close}
      footer={
        <>
          <button type="button" className="dialog-button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className={canConnect ? "dialog-button" : "dialog-button primary"}
            onClick={() => submit(false)}
          >
            {existing ? "Save" : "Save Server"}
          </button>
          {canConnect ? (
            <button
              type="button"
              className="dialog-button primary"
              onClick={() => submit(true)}
            >
              <Icon name="network" size={13} />
              Connect
            </button>
          ) : null}
        </>
      }
    >
      <p className="dialog-detail network-dialog-intro">
        Save a server address for quick access, or connect now. macOS handles
        authentication, so passwords are never stored in MAXplorer.
      </p>
      <label className="dialog-field">
        <span>Server address</span>
        <input
          value={address}
          spellCheck={false}
          placeholder="smb://server/share"
          onChange={(event) => {
            setAddress(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit(canConnect);
            }
          }}
        />
      </label>
      {normalized ? (
        <p className="dialog-detail">
          Connects as <code>{normalized}</code>
          {name.trim() ? "" : ` and appears as "${networkDisplayName(normalized)}".`}
        </p>
      ) : null}
      <div className="network-credentials">
        <label className="dialog-field">
          <span>Username (optional)</span>
          <input
            value={username}
            spellCheck={false}
            autoComplete="username"
            placeholder="DOMAIN\\user or user"
            onChange={(event) => {
              setUsername(event.target.value);
              setError(null);
            }}
          />
        </label>
        <label className="dialog-field">
          <span>Password (optional)</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="Leave blank to use Keychain"
            onChange={(event) => {
              setPassword(event.target.value);
              setError(null);
            }}
          />
        </label>
      </div>
      <p className="dialog-detail">
        These credentials are used to list shares and for the next connection, and stay
        in memory only. Leave the password blank to use your Keychain or let macOS show
        its normal sign-in sheet. MAXplorer never saves passwords.
      </p>
      <div className="network-share-actions">
        <button
          type="button"
          className="dialog-button"
          disabled={!normalized || sharesLoading}
          onClick={() => void findShares()}
        >
          {sharesLoading ? (
            <>
              <Icon name="spinner" size={13} className="spin" />
              Finding shares...
            </>
          ) : (
            <>
              <Icon name="search" size={13} />
              Find shares
            </>
          )}
        </button>
        <span className="dialog-detail">
          Uses the credentials above, then macOS Keychain, then guest access.
        </span>
      </div>
      {shares.length ? (
        <div className="network-share-list" role="list" aria-label="Available shares">
          {shares.map((share) => (
            <button
              type="button"
              className="network-share-row"
              role="listitem"
              key={share}
              onClick={() => chooseShare(share)}
            >
              <Icon name="folder" size={14} />
              <span>{share}</span>
            </button>
          ))}
        </div>
      ) : sharesError ? (
        <p className="dialog-error">{sharesError}</p>
      ) : sharesSearched ? (
        <p className="dialog-detail">
          No shares were returned. Enter a username and password above to list them,
          or enter the share name manually, for example <code>smb://PC/Share</code>.
        </p>
      ) : null}
      <label className="dialog-field">
        <span>Name (optional)</span>
        <input
          value={name}
          maxLength={60}
          spellCheck={false}
          placeholder={normalized ? networkDisplayName(normalized) : "Studio server"}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit(canConnect);
            }
          }}
        />
      </label>
      {error ? <p className="dialog-error">{error}</p> : null}
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
          <PropertiesTags path={properties.path} />
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
        <h3>Application storage</h3>
        <button
          type="button"
          className="dialog-button"
          onClick={() => openDialog({ kind: "storageAudit" })}
        >
          <Icon name="database" size={14} />
          Audit indexes, caches, and legacy data...
        </button>
        <p className="settings-hint">
          Verify the single authoritative search index and storage cache, then archive
          old build profiles and remove regenerable caches without touching current data.
        </p>
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

function StorageAuditDialog({ close }: { close: () => void }) {
  const [audit, setAudit] = useState<StorageAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StorageCleanupResult | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setAudit(await api.getStorageAudit());
    } catch (cause) {
      setError(normalizeError(cause).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const clean = async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.cleanupLegacyStorage(true);
      setResult(outcome);
      setConfirming(false);
      await load();
    } catch (cause) {
      setError(normalizeError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Application storage"
      width={760}
      icon={<Icon name="database" size={20} />}
      onClose={close}
      footer={
        <>
          <button type="button" className="dialog-button" onClick={close}>
            Close
          </button>
          <button
            type="button"
            className="dialog-button primary"
            disabled={!audit || audit.legacyCount === 0 || busy}
            onClick={() => setConfirming(true)}
          >
            <Icon name="wrench" size={14} />
            Clean up legacy data
          </button>
        </>
      }
    >
      {loading ? (
        <div className="properties-loading">
          <Icon name="spinner" size={18} className="spin" />
          Auditing application storage...
        </div>
      ) : error && !audit ? (
        <p className="dialog-error">{error}</p>
      ) : audit ? (
        <div className="storage-audit">
          <div className="storage-audit-summary">
            <div>
              <span>Authoritative data</span>
              <strong>{formatSize(audit.activeBytes)}</strong>
            </div>
            <div>
              <span>Legacy data found</span>
              <strong>{formatSize(audit.legacyBytes)}</strong>
            </div>
            <div>
              <span>Reclaimable caches</span>
              <strong>{formatSize(audit.reclaimableBytes)}</strong>
            </div>
          </div>
          <p className="dialog-path" title={audit.dataRoot}>
            {audit.dataRoot}
          </p>
          <div className="storage-audit-list">
            {audit.entries.map((entry) => (
              <div className="storage-audit-row" key={entry.id}>
                <span className={`storage-audit-badge ${entry.status}`}>
                  {entry.status}
                </span>
                <span className="storage-audit-copy">
                  <span className="storage-audit-label">{entry.label}</span>
                  <span className="storage-audit-path" title={entry.path}>
                    {entry.path}
                  </span>
                  <span className="storage-audit-detail">{entry.detail}</span>
                </span>
                <span className="storage-audit-size">{formatSize(entry.bytes)}</span>
              </div>
            ))}
          </div>
          {audit.recommendations.length ? (
            <ul className="storage-audit-recommendations">
              {audit.recommendations.map((recommendation) => (
                <li key={recommendation}>{recommendation}</li>
              ))}
            </ul>
          ) : null}
          {confirming ? (
            <div className="storage-audit-confirm">
              <Icon name="warning" size={18} />
              <div>
                <strong>Clean up legacy storage?</strong>
                <p>
                  Old WebKit profiles are archived inside the current application data
                  folder so their localStorage data is preserved. Only regenerable
                  old caches are removed. The canonical search index, storage cache,
                  logs, and current WebKit profile are never touched.
                </p>
                <div className="storage-audit-confirm-actions">
                  <button
                    type="button"
                    className="dialog-button"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="dialog-button danger"
                    disabled={busy}
                    onClick={() => void clean()}
                  >
                    {busy ? "Cleaning..." : "Archive & Clean"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {result ? (
            <div className="storage-audit-result">
              <strong>Cleanup complete</strong>
              <p>
                Archived {result.archived.length}, removed {result.removedCaches.length}{" "}
                cache folder(s), migrated {result.migrated.length}, reclaimed{" "}
                {formatSize(result.reclaimedBytes)}.
              </p>
              {result.skipped.length ? (
                <ul>
                  {result.skipped.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {result.failures.length ? (
                <ul className="storage-audit-failures">
                  {result.failures.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="dialog-error">{error}</p> : null}
        </div>
      ) : null}
    </Modal>
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
    case "tagEditor":
      return <TagEditorDialog dialog={dialog} close={close} />;
    case "networkConnection":
      return <NetworkConnectionDialog dialog={dialog} close={close} />;
    case "storageAudit":
      return <StorageAuditDialog close={close} />;
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
