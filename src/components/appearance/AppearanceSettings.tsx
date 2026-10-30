import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { AppIcon } from "../icons/AppIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { ThemePreview } from "./ThemePreview";
import { useExplorerStore } from "../../state/explorerStore";
import { useAppearanceStore } from "../../state/appearanceStore";
import { api } from "../../lib/api";
import type { IconPack, ThemeDesign } from "../../lib/appearance/model";
import {
  parseIconPackPackage,
  parseThemePackage,
  validateThemeDesign,
} from "../../lib/appearance/model";
import { designFromBuiltin, THEME_PRESETS } from "../../lib/appearance/presets";
import { iconPackCssVariables } from "../../lib/appearance/tokens";
import {
  exportThemePackageFile,
  readPackageFile,
  shareThemePackage,
  exportIconPackFile,
  shareIconPack,
} from "../../lib/appearance/files";
import { iconPackForId } from "../../lib/appearance/iconPacks";
import type { ThemeAppearance } from "../../lib/appearance/model";

type PendingImport =
  | { kind: "theme"; design: ThemeDesign; fileName: string }
  | { kind: "icon"; pack: IconPack; fileName: string };

function PackGlyphs({ pack, size = 17 }: { pack: IconPack; size?: number }) {
  return (
    <span
      className="appearance-pack-glyphs"
      style={iconPackCssVariables(pack) as CSSProperties}
      aria-hidden="true"
    >
      <FolderIcon size={size + 3} />
      <AppIcon name="fileText" size={size} strokeWidth={pack.strokeWidth} />
      <AppIcon name="fileImage" size={size} strokeWidth={pack.strokeWidth} />
    </span>
  );
}

function currentAppearance(mode: "system" | "light" | "dark"): ThemeAppearance {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export function AppearanceSettings() {
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const setInterfaceTheme = useExplorerStore((state) => state.setInterfaceTheme);
  const themeMode = useExplorerStore((state) => state.theme);
  const setTheme = useExplorerStore((state) => state.setTheme);
  const openDialog = useExplorerStore((state) => state.openDialog);

  const themes = useAppearanceStore((state) => state.themes);
  const activeThemeId = useAppearanceStore((state) => state.activeThemeId);
  const setActiveTheme = useAppearanceStore((state) => state.setActiveTheme);
  const renameTheme = useAppearanceStore((state) => state.renameTheme);
  const deleteTheme = useAppearanceStore((state) => state.deleteTheme);
  const duplicateTheme = useAppearanceStore((state) => state.duplicateTheme);
  const importTheme = useAppearanceStore((state) => state.importTheme);
  const iconPacks = useAppearanceStore((state) => state.iconPacks);
  const activeIconPackId = useAppearanceStore((state) => state.activeIconPackId);
  const setActiveIconPack = useAppearanceStore((state) => state.setActiveIconPack);
  const importIconPack = useAppearanceStore((state) => state.importIconPack);

  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameCancelled = useRef(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const appearance = currentAppearance(themeMode);
  const builtInPreviews = useMemo(
    () => ({
      windows: designFromBuiltin("windows", appearance, "Windows 11 Explorer"),
      finder: designFromBuiltin("finder", appearance, "macOS Finder"),
    }),
    [appearance],
  );
  const activePack = iconPackForId(iconPacks, activeIconPackId);
  const activeDesign = themes.find((theme) => theme.id === activeThemeId) ?? null;
  const activeDesignPack =
    activeDesign?.iconPackId && activeDesign.iconPackId !== activeIconPackId
      ? iconPackForId(iconPacks, activeDesign.iconPackId)
      : null;
  const templates = showAllTemplates ? THEME_PRESETS : THEME_PRESETS.slice(0, 6);
  const toast = (message: string, detail?: string) =>
    useExplorerStore.getState().toast({ title: message, detail, tone: "success" });

  const applyTheme = (id: string) => setActiveTheme(id);

  const applyBuiltIn = (id: "windows" | "finder") => {
    setActiveTheme(null);
    setInterfaceTheme(id);
  };

  const editTheme = (theme: ThemeDesign) => {
    openDialog({ kind: "themeCreator", start: { kind: "theme", themeId: theme.id } });
  };

  const duplicate = (theme: ThemeDesign) => {
    const copy = duplicateTheme(theme.id);
    if (copy) {
      toast("Theme duplicated", `${copy.name} is a separate copy. The original is unchanged.`);
      openDialog({ kind: "themeCreator", start: { kind: "theme", themeId: copy.id } });
    }
  };

  const beginRename = (theme: ThemeDesign) => {
    renameCancelled.current = false;
    setRenamingId(theme.id);
    setRenameValue(theme.name);
  };

  const commitRename = () => {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      setRenamingId(null);
      setRenameValue("");
      return;
    }
    if (renamingId && renameValue.trim()) {
      renameTheme(renamingId, renameValue);
      toast("Theme renamed", renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const removeTheme = (theme: ThemeDesign) => {
    deleteTheme(theme.id);
    setConfirmDeleteId(null);
    toast("Theme deleted", `${theme.name} was removed. Built-in themes are unaffected.`);
  };

  const exportTheme = async (theme: ThemeDesign) => {
    try {
      const result = await exportThemePackageFile(theme);
      useExplorerStore.getState().toast({
        title: "Theme exported",
        detail: result.path ?? result.fileName,
        tone: "success",
        actionLabel: result.path ? "Reveal in Finder" : undefined,
        onAction: result.path ? () => void api.revealPath(result.path as string).catch(() => undefined) : undefined,
      });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  };

  const share = async (theme: ThemeDesign) => {
    const copied = await shareThemePackage(theme);
    if (copied) {
      toast("Share text copied", "Paste it into a message or email to share the theme package.");
    } else {
      toast("Could not copy the share text", "Use Export instead and send the .maxTheme file.");
    }
  };

  const exportPack = async (pack: IconPack) => {
    try {
      const result = await exportIconPackFile(pack);
      useExplorerStore.getState().toast({
        title: "Icon pack exported",
        detail: result.path ?? result.fileName,
        tone: "success",
        actionLabel: result.path ? "Reveal in Finder" : undefined,
        onAction: result.path ? () => void api.revealPath(result.path as string).catch(() => undefined) : undefined,
      });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  };

  const sharePack = async (pack: IconPack) => {
    const copied = await shareIconPack(pack);
    if (copied) toast("Share text copied", "Paste it to share this icon pack.");
    else toast("Could not copy the share text", "Use Export instead.");
  };

  const readImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const contents = await readPackageFile(file);
      const themeResult = parseThemePackage(contents);
      if (themeResult.ok) {
        setPendingImport({ kind: "theme", design: themeResult.value.theme, fileName: file.name });
        return;
      }
      const iconResult = parseIconPackPackage(contents);
      if (iconResult.ok) {
        setPendingImport({ kind: "icon", pack: iconResult.value.iconPack, fileName: file.name });
        return;
      }
      useExplorerStore.getState().toast({
        title: "This package could not be opened",
        detail: themeResult.error,
        tone: "error",
      });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  };

  const installImport = () => {
    if (!pendingImport) return;
    if (pendingImport.kind === "theme") {
      const installed = importTheme(pendingImport.design);
      if (installed) {
        toast("Theme installed", `${installed.name} is now available in Your themes.`);
      } else {
        toast("This theme could not be installed", "The package did not contain a valid theme.");
      }
    } else {
      const installed = importIconPack(pendingImport.pack);
      if (installed) {
        toast("Icon pack installed", `${installed.name} is now available for every theme.`);
      } else {
        toast("This icon pack could not be installed", "The package did not contain valid icon information.");
      }
    }
    setPendingImport(null);
  };

  const pendingValidation =
    pendingImport?.kind === "theme" ? validateThemeDesign(pendingImport.design) : null;

  useEffect(() => {
    if (!pendingImport) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingImport(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingImport]);

  return (
    <div className="appearance-page">
      <input
        ref={themeInputRef}
        type="file"
        accept=".maxTheme,.theme,application/json"
        hidden
        onChange={(event) => void readImport(event)}
      />
      <input
        ref={iconInputRef}
        type="file"
        accept=".maxIcons,.icons,application/json"
        hidden
        onChange={(event) => void readImport(event)}
      />

      <section className="appearance-hero" aria-labelledby="create-theme-heading">
        <span className="appearance-hero-icon">
          <AppIcon name="palette" size={26} />
        </span>
        <div className="appearance-hero-copy">
          <h3 id="create-theme-heading">Make MAXplorer yours</h3>
          <p>
            Pick a look, change a colour, and save. No code, no files, no technical settings.
            You can build a complete theme in about five minutes.
          </p>
        </div>
        <div className="appearance-hero-actions">
          <button
            type="button"
            className="appearance-primary-button"
            onClick={() => openDialog({ kind: "themeCreator" })}
          >
            <AppIcon name="plus" size={15} />
            Create Your Theme
          </button>
          <button
            type="button"
            className="appearance-secondary-button"
            onClick={() => themeInputRef.current?.click()}
          >
            <AppIcon name="downloads" size={14} />
            Import theme
          </button>
        </div>
      </section>

      <div className="appearance-note">
        <AppIcon name="info" size={14} />
        <span>
          Themes change how MAXplorer looks, never how it works. Your files, tabs, and folders
          stay exactly where they are.
        </span>
      </div>

      <section className="appearance-section" aria-labelledby="built-in-heading">
        <div className="appearance-section-head">
          <div>
            <h3 id="built-in-heading">Built-in themes</h3>
            <p>
              Two complete designs, each ready in light and dark. A custom theme keeps its
              own appearance; edit it to change it.
            </p>
          </div>
          <div className="appearance-segmented" role="group" aria-label="Light and dark appearance">
            {(
              [
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ] as Array<{ value: "system" | "light" | "dark"; label: string }>
            ).map((option) => (
              <button
                type="button"
                key={option.value}
                className={`appearance-option ${themeMode === option.value ? "active" : ""}`}
                aria-pressed={themeMode === option.value}
                onClick={() => setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-grid two" role="group" aria-labelledby="built-in-heading">
          {(["windows", "finder"] as const).map((id) => {
            const active = !activeThemeId && interfaceTheme === id;
            const design = builtInPreviews[id];
            const label = id === "finder" ? "macOS Finder" : "Windows 11 Explorer";
            return (
              <div key={id} className={`appearance-library-card ${active ? "active" : ""}`}>
                <button
                  type="button"
                  className="appearance-library-preview"
                  aria-pressed={active}
                  aria-label={`Apply ${label}${active ? " (active theme)" : ""}`}
                  onClick={() => applyBuiltIn(id)}
                >
                  <ThemePreview design={design} iconPack={activePack} mini />
                </button>
                <div className="appearance-library-meta">
                  <div>
                    <span className="appearance-library-title">{label}</span>
                    <span className="appearance-library-sub">
                      {id === "finder"
                        ? "Source list, rounded controls, and macOS spacing."
                        : "Fluent surfaces, command bar, and Explorer rhythm."}
                    </span>
                  </div>
                  {active ? (
                    <span className="appearance-badge">
                      <AppIcon name="check" size={10} />
                      Active
                    </span>
                  ) : null}
                </div>
                <div className="appearance-card-actions">
                  <button
                    type="button"
                    className="appearance-card-action"
                    onClick={() => applyBuiltIn(id)}
                  >
                    {active ? "Applied" : "Apply"}
                  </button>
                  <button
                    type="button"
                    className="appearance-card-action"
                    onClick={() =>
                      openDialog({
                        kind: "themeCreator",
                        start: { kind: "builtin", theme: id, appearance },
                      })
                    }
                  >
                    <AppIcon name="rename" size={11} />
                    Customise a copy
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="appearance-section" aria-labelledby="your-themes-heading">
        <div className="appearance-section-head">
          <div>
            <h3 id="your-themes-heading">Your themes</h3>
            <p>
              Saved themes live here. Edit, duplicate, export, or share any of them at any time.
            </p>
          </div>
          <button
            type="button"
            className="appearance-secondary-button"
            onClick={() => themeInputRef.current?.click()}
          >
            <AppIcon name="downloads" size={13} />
            Import
          </button>
        </div>
        {themes.length ? (
          <div className="appearance-grid two">
            {themes.map((theme) => {
              const active = activeThemeId === theme.id;
              const pack = iconPackForId(iconPacks, theme.iconPackId ?? activeIconPackId);
              return (
                <div key={theme.id} className={`appearance-library-card ${active ? "active" : ""}`}>
                  <button
                    type="button"
                    className="appearance-library-preview"
                    aria-pressed={active}
                    aria-label={`Apply ${theme.name}${active ? " (active theme)" : ""}`}
                    onClick={() => applyTheme(theme.id)}
                  >
                    <ThemePreview design={theme} iconPack={pack} mini />
                  </button>
                  <div className="appearance-library-meta">
                    <div style={{ minWidth: 0 }}>
                      {renamingId === theme.id ? (
                        <input
                          className="creator-input"
                          style={{ height: 26, fontSize: 11 }}
                          value={renameValue}
                          autoFocus
                          aria-label="Theme name"
                          onChange={(event) => setRenameValue(event.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRename();
                            if (event.key === "Escape") {
                              renameCancelled.current = true;
                              setRenamingId(null);
                              setRenameValue("");
                            }
                          }}
                        />
                      ) : (
                        <span className="appearance-library-title">{theme.name}</span>
                      )}
                      <span className="appearance-library-sub">
                        {theme.description || `${theme.base === "finder" ? "Finder" : "Windows"} layout · ${theme.appearance}`}
                      </span>
                    </div>
                    {active ? (
                      <span className="appearance-badge">
                        <AppIcon name="check" size={10} />
                        Active
                      </span>
                    ) : null}
                  </div>
                  {confirmDeleteId === theme.id ? (
                    <div className="appearance-confirm-inline">
                      <span>Delete “{theme.name}”?</span>
                      <button type="button" onClick={() => removeTheme(theme)}>
                        Delete
                      </button>
                      <button
                        type="button"
                        className="keep"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="appearance-card-actions">
                      <button type="button" className="appearance-card-action" onClick={() => editTheme(theme)}>
                        <AppIcon name="rename" size={11} />
                        Edit
                      </button>
                      <button type="button" className="appearance-card-action" onClick={() => duplicate(theme)}>
                        <AppIcon name="copy" size={11} />
                        Duplicate
                      </button>
                      <button type="button" className="appearance-card-action" onClick={() => beginRename(theme)}>
                        Rename
                      </button>
                      <button type="button" className="appearance-card-action" onClick={() => void exportTheme(theme)}>
                        <AppIcon name="downloads" size={11} />
                        Export
                      </button>
                      <button type="button" className="appearance-card-action" onClick={() => void share(theme)}>
                        <AppIcon name="share" size={11} />
                        Share
                      </button>
                      <button
                        type="button"
                        className="appearance-card-action danger"
                        onClick={() => setConfirmDeleteId(theme.id)}
                      >
                        <AppIcon name="delete" size={11} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="appearance-note">
            <AppIcon name="info" size={14} />
            <span>
              You haven't saved a theme yet. Pick a template below, or start from scratch with
              Create Your Theme. Your first theme can be as simple as one colour change.
            </span>
          </div>
        )}
      </section>

      <section className="appearance-section" aria-labelledby="templates-heading">
        <div className="appearance-section-head">
          <div>
            <h3 id="templates-heading">Start from a template</h3>
            <p>
              Professional starting points. Choosing one opens a copy in the Theme Creator; the
              template itself never changes.
            </p>
          </div>
          <button
            type="button"
            className="appearance-ghost-button"
            onClick={() => setShowAllTemplates((value) => !value)}
          >
            {showAllTemplates ? "Show fewer" : `Show all ${THEME_PRESETS.length}`}
          </button>
        </div>
        <div className="appearance-grid three">
          {templates.map((preset) => {
            const previewPack = iconPackForId(iconPacks, preset.iconPackId ?? activeIconPackId);
            const design = {
              ...builtInPreviews.windows,
              ...preset,
              name: preset.name,
              description: preset.description,
              iconPackId: preset.iconPackId,
              overrides: {},
              createdAt: builtInPreviews.windows.createdAt,
              updatedAt: builtInPreviews.windows.updatedAt,
              packageId: builtInPreviews.windows.packageId,
            } as ThemeDesign;
            return (
              <button
                type="button"
                key={preset.id}
                className="appearance-library-card"
                style={{ textAlign: "left", cursor: "pointer" }}
                aria-label={`Start from the ${preset.name} template`}
                onClick={() =>
                  openDialog({
                    kind: "themeCreator",
                    start: { kind: "preset", presetId: preset.id },
                  })
                }
              >
                <span className="appearance-library-preview">
                  <ThemePreview design={design} iconPack={previewPack} mini />
                </span>
                <span className="appearance-library-meta">
                  <span style={{ minWidth: 0 }}>
                    <span className="appearance-library-title">{preset.name}</span>
                    <span className="appearance-library-sub">{preset.description}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="appearance-section" aria-labelledby="icons-heading">
        <div className="appearance-section-head">
          <div>
            <h3 id="icons-heading">Icon packs</h3>
            <p>
              Icons are independent from colour themes. Choose one for MAXplorer, or install a
              `.maxIcons` pack.
            </p>
          </div>
          <button
            type="button"
            className="appearance-secondary-button"
            onClick={() => iconInputRef.current?.click()}
          >
            <AppIcon name="downloads" size={13} />
            Import icon pack
          </button>
        </div>
        <div className="appearance-grid two">
          {iconPacks.map((pack) => {
            const active = pack.id === activeIconPackId;
            return (
              <div
                key={pack.id}
                className={`appearance-pack-card ${active ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="appearance-pack-main"
                  aria-pressed={active}
                  onClick={() => setActiveIconPack(pack.id)}
                >
                  <PackGlyphs pack={pack} />
                  <span className="appearance-pack-copy">
                    <strong>
                      {pack.name}
                      {active ? " · Active" : ""}
                    </strong>
                    <span>{pack.description}</span>
                  </span>
                </button>
                <span className="appearance-pack-actions">
                  <button
                    type="button"
                    className="appearance-card-action"
                    aria-label={`Export ${pack.name}`}
                    onClick={() => void exportPack(pack)}
                  >
                    <AppIcon name="downloads" size={11} />
                  </button>
                  <button
                    type="button"
                    className="appearance-card-action"
                    aria-label={`Share ${pack.name}`}
                    onClick={() => void sharePack(pack)}
                  >
                    <AppIcon name="share" size={11} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        {activeDesignPack ? (
          <div className="appearance-note">
            <AppIcon name="info" size={14} />
            <span>
              The active theme remembers <strong>{activeDesignPack.name}</strong>. Open
              <strong> Edit</strong> in Your themes to change the pack for that theme, or use
              Follow MAXplorer when creating a theme to use this setting.
            </span>
          </div>
        ) : null}
      </section>

      {pendingImport ? (
        <div
          className="appearance-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingImport(null);
          }}
        >
          <div className="appearance-modal" role="dialog" aria-modal="true" aria-label="Install package">
            <div className="appearance-modal-head">
              <AppIcon name="downloads" size={18} />
              <h2>Install {pendingImport.kind === "theme" ? "theme" : "icon pack"}</h2>
              <button type="button" className="modal-close" aria-label="Close" onClick={() => setPendingImport(null)}>
                <AppIcon name="close" size={12} />
              </button>
            </div>
            <div className="appearance-modal-body">
              {pendingImport.kind === "theme" ? (
                <div className="import-preview">
                  <div className="import-preview-window">
                    <ThemePreview
                      design={pendingImport.design}
                      iconPack={iconPackForId(
                        iconPacks,
                        pendingImport.design.iconPackId ?? activeIconPackId,
                      )}
                    />
                  </div>
                  <div className={`import-validation ${pendingValidation?.ok ? "good" : "bad"}`}>
                    <AppIcon
                      name={pendingValidation?.ok ? "checkCircle" : "warning"}
                      size={14}
                    />
                    <span>
                      {pendingValidation?.ok
                        ? "This package passed validation and is ready to install."
                        : pendingValidation?.issues[0]?.message ?? "This package needs attention."}
                    </span>
                  </div>
                  <dl className="import-details">
                    <dt>Name</dt>
                    <dd>{pendingImport.design.name}</dd>
                    <dt>Author</dt>
                    <dd>{pendingImport.design.author || "Not specified"}</dd>
                    <dt>Package</dt>
                    <dd>{pendingImport.design.packageId}</dd>
                    <dt>File</dt>
                    <dd>{pendingImport.fileName}</dd>
                  </dl>
                  {pendingValidation && pendingValidation.issues.length > 1 ? (
                    <div className="creator-issues">
                      {pendingValidation.issues.slice(1).map((issue) => (
                        <div className="creator-issue" key={issue.message}>
                          <AppIcon name="warning" size={13} />
                          <span>{issue.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="import-preview">
                  <div className="creator-icon-samples" style={{ justifyContent: "center" }}>
                    <PackGlyphs pack={pendingImport.pack} size={26} />
                    <span style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {pendingImport.pack.name}
                    </span>
                  </div>
                  <div className="import-validation good">
                    <AppIcon name="checkCircle" size={14} />
                    <span>This icon pack is valid and can be combined with any theme.</span>
                  </div>
                  <dl className="import-details">
                    <dt>Name</dt>
                    <dd>{pendingImport.pack.name}</dd>
                    <dt>Author</dt>
                    <dd>{pendingImport.pack.author || "Not specified"}</dd>
                    <dt>File</dt>
                    <dd>{pendingImport.fileName}</dd>
                  </dl>
                </div>
              )}
            </div>
            <div className="appearance-modal-footer">
              <button type="button" className="dialog-button" onClick={() => setPendingImport(null)}>
                Cancel
              </button>
              <button type="button" className="dialog-button primary" onClick={installImport}>
                Install
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
