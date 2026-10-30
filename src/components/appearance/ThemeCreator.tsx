import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AppIcon } from "../icons/AppIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { ThemePreview } from "./ThemePreview";
import { useExplorerStore } from "../../state/explorerStore";
import { useAppearanceStore } from "../../state/appearanceStore";
import type { ThemeCreatorStart } from "../../lib/types";
import { contrastRatio, generateMatchingPalette } from "../../lib/appearance/color";
import {
  normalizeThemeDesign,
  repairThemeContrast,
  validateThemeDesign,
  type IconPack,
  type ThemeAppearance,
  type ThemeCreatorMode,
  type ThemeDesign,
  type ThemeDensity,
  type ThemePalette,
  type ThemeStyle,
} from "../../lib/appearance/model";
import {
  ADVANCED_TOKEN_GROUPS,
  iconPackCssVariables,
  themeCssVariables,
} from "../../lib/appearance/tokens";
import {
  applyPalette,
  createBlankTheme,
  designFromBuiltin,
  designFromPreset,
  duplicateThemeDesign,
  presetById,
  readyPaletteById,
  READY_PALETTES,
  THEME_PRESETS,
} from "../../lib/appearance/presets";
import { iconPackForId } from "../../lib/appearance/iconPacks";
import {
  exportThemePackageFile,
  shareThemePackage,
} from "../../lib/appearance/files";
import { generateThemeFromDescription } from "../../lib/appearance/ai";

const STEPS: ReadonlyArray<{ key: string; title: string; subtitle: string }> = [
  { key: "name", title: "Name", subtitle: "Give it a home" },
  { key: "look", title: "Look", subtitle: "Pick a starting style" },
  { key: "colours", title: "Colours", subtitle: "Choose a palette" },
  { key: "style", title: "Style", subtitle: "Shape and spacing" },
  { key: "icons", title: "Icons", subtitle: "Optional icon pack" },
  { key: "preview", title: "Preview & Save", subtitle: "See it, then keep it" },
];

interface ThemeCreatorProps {
  start?: ThemeCreatorStart;
  close: () => void;
  /** Internal preview harness: opens directly on a step. */
  initialStep?: number;
  initialMode?: ThemeCreatorMode;
}

function systemAppearance(): ThemeAppearance {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function resolvedStoreAppearance(mode: "system" | "light" | "dark"): ThemeAppearance {
  return mode === "light" || mode === "dark" ? mode : systemAppearance();
}

function initialDesignForStart(start: ThemeCreatorStart | undefined, fallback: ThemeDesign): ThemeDesign {
  if (!start) return fallback;
  const store = useAppearanceStore.getState();
  switch (start.kind) {
    case "blank":
      return createBlankTheme("My Theme");
    case "current": {
      const active = store.themes.find((theme) => theme.id === store.activeThemeId);
      if (active) return duplicateThemeDesign(active);
      const explorer = useExplorerStore.getState();
      return designFromBuiltin(explorer.interfaceTheme, resolvedStoreAppearance(explorer.theme));
    }
    case "preset": {
      const preset = presetById(start.presetId);
      return preset ? designFromPreset(preset) : fallback;
    }
    case "theme": {
      const source = store.themes.find((theme) => theme.id === start.themeId);
      return source ? normalizeThemeDesign(source) ?? fallback : fallback;
    }
    case "builtin":
      return designFromBuiltin(start.theme, start.appearance);
    case "palette": {
      const ready = readyPaletteById(start.paletteId);
      if (!ready) return fallback;
      const blank = createBlankTheme(`${ready.name} Theme`);
      return applyPalette(blank, ready.palette, ready.appearance);
    }
    default:
      return fallback;
  }
}

function SaveButton({
  children,
  onClick,
  primary,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={primary ? "dialog-button primary" : "dialog-button"}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value.toUpperCase());
  useEffect(() => setText(value.toUpperCase()), [value]);
  return (
    <label className="creator-color-field">
      <span>{label}</span>
      <span className="creator-color-control">
        <input
          type="color"
          value={value}
          aria-label={`${label} colour`}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="text"
          value={text}
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (/^#[0-9a-f]{6}$/i.test(next.trim())) onChange(next.trim().toLowerCase());
          }}
          onBlur={() => setText(value.toUpperCase())}
        />
      </span>
    </label>
  );
}

function StyleChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint: string; demo: ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="creator-section-block">
      <h3>{label}</h3>
      <div className="creator-choice-grid" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={`creator-choice ${value === option.value ? "active" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            <span className="creator-choice-demo" aria-hidden="true">
              {option.demo}
            </span>
            <span className="creator-choice-copy">
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PackSamples({ pack }: { pack: IconPack }) {
  return (
    <div className="creator-icon-samples" style={iconPackCssVariables(pack) as CSSProperties}>
      <span className="creator-icon-sample-group">
        <span>Toolbar</span>
        <AppIcon name="new" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="copy" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="rename" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="share" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="delete" size={16} strokeWidth={pack.strokeWidth} />
      </span>
      <span className="creator-icon-sample-group">
        <span>Navigation</span>
        <AppIcon name="home" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="desktop" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="documents" size={16} strokeWidth={pack.strokeWidth} />
        <AppIcon name="downloads" size={16} strokeWidth={pack.strokeWidth} />
      </span>
      <span className="creator-icon-sample-group">
        <span>Folders</span>
        <FolderIcon size={18} />
        <FolderIcon size={18} variant="favorite" />
      </span>
      <span className="creator-icon-sample-group">
        <span>Files</span>
        <AppIcon name="fileText" size={16} strokeWidth={pack.strokeWidth} style={{ color: "var(--file-accent-text)" }} />
        <AppIcon name="fileImage" size={16} strokeWidth={pack.strokeWidth} style={{ color: "var(--file-accent-image)" }} />
        <AppIcon name="pdf" size={16} strokeWidth={pack.strokeWidth} style={{ color: "var(--file-accent-pdf)" }} />
        <AppIcon name="fileArchive" size={16} strokeWidth={pack.strokeWidth} style={{ color: "var(--file-accent-archive)" }} />
      </span>
    </div>
  );
}

function EffectiveTokenEditor({
  design,
  onChange,
}: {
  design: ThemeDesign;
  onChange: (design: ThemeDesign) => void;
}) {
  const effective = themeCssVariables(design);
  const setOverride = (token: string, value: string) => {
    const overrides = { ...design.overrides };
    if (value.trim()) overrides[token] = value;
    else delete overrides[token];
    onChange({ ...design, overrides, updatedAt: new Date().toISOString() });
  };
  return (
    <div className="creator-token-groups">
      {ADVANCED_TOKEN_GROUPS.map((group) => (
        <div className="creator-token-group" key={group.label}>
          <h4>{group.label}</h4>
          <div className="creator-token-list">
            {group.tokens.map((token) => {
              const value = design.overrides[token.name] ?? effective[token.name] ?? "";
              return (
                <div className="creator-token-row" key={token.name}>
                  <label htmlFor={`token-${token.name}`} title={token.name}>
                    {token.label}
                  </label>
                  <input
                    id={`token-${token.name}`}
                    type="text"
                    value={value}
                    spellCheck={false}
                    aria-label={`${token.label} token value`}
                    onChange={(event) => setOverride(token.name, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ThemeCreator({ start, close, initialStep, initialMode }: ThemeCreatorProps) {
  const themes = useAppearanceStore((state) => state.themes);
  const activeThemeId = useAppearanceStore((state) => state.activeThemeId);
  const iconPacks = useAppearanceStore((state) => state.iconPacks);
  const activeIconPackId = useAppearanceStore((state) => state.activeIconPackId);
  const saveTheme = useAppearanceStore((state) => state.saveTheme);
  const duplicateTheme = useAppearanceStore((state) => state.duplicateTheme);
  const storeDraft = useAppearanceStore((state) => state.storeDraft);
  const discardDraft = useAppearanceStore((state) => state.discardDraft);
  const interfaceTheme = useExplorerStore((state) => state.interfaceTheme);
  const explorerThemeMode = useExplorerStore((state) => state.theme);
  const appearance = resolvedStoreAppearance(explorerThemeMode);
  const activeDesign = themes.find((theme) => theme.id === activeThemeId) ?? null;
  const availableDraft = useAppearanceStore((state) => state.draft);

  const [initial] = useState(() => {
    const fallback = createBlankTheme("My Theme");
    if (start) {
      return {
        design: initialDesignForStart(start, fallback),
        step: initialStep ?? 1,
        mode: initialMode ?? "simple",
      };
    }
    if (availableDraft) {
      return { design: availableDraft.design, step: 0, mode: availableDraft.mode };
    }
    return { design: fallback, step: initialStep ?? 0, mode: initialMode ?? "simple" };
  });

  const [history, setHistory] = useState<ThemeDesign[]>([initial.design]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const design = history[historyIndex];
  const [step, setStep] = useState(initial.step);
  const [mode, setMode] = useState<ThemeCreatorMode>(initial.mode);
  const [completed, setCompleted] = useState<Set<number>>(() => new Set(initial.step > 1 ? [1] : []));
  const [view, setView] = useState<"list" | "grid">("list");
  const [dualPane, setDualPane] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [savedDesign, setSavedDesign] = useState<ThemeDesign | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const resumeDraft = Boolean(availableDraft && !start);

  const packForDesign = iconPackForId(iconPacks, design.iconPackId ?? activeIconPackId);
  const activeThemeName = activeDesign?.name ?? (interfaceTheme === "finder" ? "macOS Finder" : "Windows 11 Explorer");
  const validation = validateThemeDesign(design);
  const contrast = contrastRatio(design.palette.text, design.palette.surface);
  const contrastGood = contrast >= 4.5;
  const nameValid = design.name.trim().length > 0;
  const canSave = nameValid;

  useEffect(() => {
    const panel = modalRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = panel?.querySelector<HTMLElement>(
      "input, textarea, select, button, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "input, textarea, select, button, [href], [tabindex]:not([tabindex='-1'])",
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
      previous?.focus();
    };
  }, [close]);

  useEffect(() => {
    if (savedDesign || step < 1) return;
    const timer = window.setTimeout(() => {
      storeDraft({
        version: 1,
        design,
        step,
        mode,
        savedAt: Date.now(),
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [design, step, mode, savedDesign, storeDraft]);

  const commit = (next: ThemeDesign) => {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    const nextHistory = [...history.slice(0, historyIndex + 1), updated].slice(-80);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  const update = (patch: Partial<ThemeDesign>) => commit({ ...design, ...patch });
  const updatePalette = (patch: Partial<ThemePalette>) =>
    commit({
      ...design,
      presetId: null,
      palette: { ...design.palette, ...patch },
      updatedAt: new Date().toISOString(),
    });
  const updateStyle = <K extends keyof ThemeStyle>(key: K, value: ThemeStyle[K]) =>
    commit({
      ...design,
      presetId: null,
      style: { ...design.style, [key]: value },
      updatedAt: new Date().toISOString(),
    });

  const undo = () => {
    if (historyIndex > 0) setHistoryIndex(historyIndex - 1);
  };
  const redo = () => {
    if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1);
  };

  const go = (next: number) => {
    setCompleted((current) => new Set(current).add(step));
    setStep(next);
  };

  const applyStart = (next: ThemeDesign) => {
    setHistory([next]);
    setHistoryIndex(0);
    setCompleted(new Set());
    setStep(1);
    setAiSummary(null);
  };

  const choosePreset = (presetId: string) => {
    const preset = presetById(presetId);
    if (!preset) return;
    commit({
      ...design,
      base: preset.base,
      appearance: preset.appearance,
      palette: { ...preset.palette },
      style: { ...preset.style },
      iconPackId: preset.iconPackId,
      presetId: preset.id,
      updatedAt: new Date().toISOString(),
    });
  };

  const autoColours = () => {
    const generated = generateMatchingPalette(design.palette.accent, design.appearance);
    commit({
      ...design,
      presetId: null,
      palette: {
        ...generated,
        selection: design.palette.accent,
      },
      updatedAt: new Date().toISOString(),
    });
  };

  const resetColours = () => {
    const source = designFromBuiltin(design.base, design.appearance);
    commit({
      ...design,
      presetId: null,
      palette: { ...source.palette },
      updatedAt: new Date().toISOString(),
    });
  };

  const resetStyle = () => {
    const source = presetById(design.presetId) ?? presetById("modern-minimal") ?? THEME_PRESETS[0];
    commit({
      ...design,
      style: { ...source.style },
      updatedAt: new Date().toISOString(),
    });
  };

  const fixContrast = () => commit(repairThemeContrast(design));

  const runDescription = async () => {
    const prompt = aiPrompt.trim();
    if (!prompt || aiBusy) return;
    setAiBusy(true);
    try {
      const result = await generateThemeFromDescription(prompt, design);
      commit({
        ...result.design,
        id: design.id,
        packageId: design.packageId,
        name: design.name === "My Theme" ? result.design.name : design.name,
      });
      setAiSummary(result.summary);
      go(6);
    } catch {
      useExplorerStore.getState().toast({
        title: "The description could not be turned into a theme",
        detail: "Try a simpler description, or choose a preset below.",
        tone: "error",
      });
    } finally {
      setAiBusy(false);
    }
  };

  const saveNow = () => {
    if (!canSave) {
      useExplorerStore.getState().toast({
        title: "Name your theme first",
        detail: "Every theme needs a name before it can be saved.",
        tone: "info",
      });
      return;
    }
    const normalized =
      normalizeThemeDesign({
        ...design,
        name: design.name.trim(),
        updatedAt: new Date().toISOString(),
      }) ?? design;
    const saved = saveTheme(normalized);
    if (saved) {
      discardDraft();
      setHistory([saved]);
      setHistoryIndex(0);
      setSavedDesign(saved);
      setSavedPath(null);
      useExplorerStore.getState().toast({
        title: "Theme saved",
        detail: `${saved.name} is now active. You can export or share it any time.`,
        tone: "success",
      });
    }
  };

  const exportSaved = async () => {
    if (!savedDesign) return;
    try {
      const result = await exportThemePackageFile(savedDesign);
      setSavedPath(result.path ?? result.fileName);
      useExplorerStore.getState().toast({
        title: "Theme exported",
        detail: result.path ?? result.fileName,
        tone: "success",
      });
    } catch (error) {
      useExplorerStore.getState().toastError(error);
    }
  };

  const shareSaved = async () => {
    if (!savedDesign) return;
    const copied = await shareThemePackage(savedDesign);
    useExplorerStore.getState().toast({
      title: copied ? "Share text copied" : "Could not copy the share text",
      detail: copied ? "Paste it into a message or email to share your theme." : "Use Export instead.",
      tone: copied ? "success" : "error",
    });
  };

  const duplicateSaved = () => {
    if (!savedDesign) return;
    const copy = duplicateTheme(savedDesign.id);
    if (copy) {
      useExplorerStore.getState().toast({
        title: "Theme duplicated",
        detail: `${copy.name} is in Your themes.`,
        tone: "success",
      });
    }
  };

  const startAnother = () => {
    const blank = createBlankTheme("My Theme");
    setSavedDesign(null);
    setSavedPath(null);
    setHistory([blank]);
    setHistoryIndex(0);
    setStep(0);
    setCompleted(new Set());
    setAiSummary(null);
    setAiPrompt("");
  };

  const continueEditing = () => {
    setSavedDesign(null);
    setStep(6);
    setCompleted((current) => new Set(current).add(1).add(2).add(3).add(4).add(5));
  };

  const currentStepLabel = step === 0 ? "Start" : `Step ${step} of 6`;
  const showPreviewColumn = step >= 1 && step <= 5 && !savedDesign;
  const isAdvanced = mode === "advanced";

  const previewColumn = showPreviewColumn ? (
    <aside className="theme-creator-preview-column" aria-label="Live preview">
      <div className="creator-preview-panel">
        <div className="creator-preview-panel-head">
          <span>Live preview</span>
          <span>{currentStepLabel}</span>
        </div>
        <ThemePreview
          design={design}
          iconPack={packForDesign}
          view={view}
          dualPane={dualPane}
          showContextMenu={showContextMenu}
        />
        <div className="creator-preview-controls">
          <button
            type="button"
            className={`creator-preview-control ${view === "list" ? "active" : ""}`}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <AppIcon name="list" size={12} />
            List
          </button>
          <button
            type="button"
            className={`creator-preview-control ${view === "grid" ? "active" : ""}`}
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <AppIcon name="grid" size={12} />
            Grid
          </button>
          <button
            type="button"
            className={`creator-preview-control ${dualPane ? "active" : ""}`}
            aria-pressed={dualPane}
            onClick={() => setDualPane((value) => !value)}
          >
            <AppIcon name="columns" size={12} />
            Dual pane
          </button>
          <button
            type="button"
            className={`creator-preview-control ${showContextMenu ? "active" : ""}`}
            aria-pressed={showContextMenu}
            onClick={() => setShowContextMenu((value) => !value)}
          >
            <AppIcon name="more" size={12} />
            Menu
          </button>
        </div>
      </div>
      <div className="appearance-note">
        <AppIcon name="info" size={13} />
        <span>
          This is the actual design. Your files and folders are never changed by a theme.
        </span>
      </div>
    </aside>
  ) : null;

  const renderStart = () => (
    <div className="creator-start">
      <div className="creator-start-hero">
        <span className="creator-start-hero-icon">
          <AppIcon name="palette" size={23} />
        </span>
        <div>
          <h2>Create a theme that feels like yours</h2>
          <p>
            Start with a ready-made look, copy what you have now, or begin with a blank canvas.
            You can change everything later. No technical knowledge is needed.
          </p>
        </div>
      </div>

      {resumeDraft && availableDraft ? (
        <div className="creator-draft-banner">
          <AppIcon name="clock" size={15} />
          <span>
            <strong>You have an unfinished theme.</strong> {availableDraft.design.name} was saved
            automatically. Pick up where you left off?
          </span>
          <button
            type="button"
            className="dialog-button primary"
            onClick={() => {
              setHistory([availableDraft.design]);
              setHistoryIndex(0);
              setStep(availableDraft.step);
              setMode(availableDraft.mode);
              setCompleted(new Set(Array.from({ length: Math.max(0, availableDraft.step - 1) }, (_, index) => index + 2)));
            }}
          >
            Continue
          </button>
          <button
            type="button"
            className="dialog-button"
            onClick={() => {
              discardDraft();
              applyStart(createBlankTheme("My Theme"));
            }}
          >
            Start over
          </button>
        </div>
      ) : null}

      <div className="creator-start-grid">
        <button
          type="button"
          className="creator-start-card"
          onClick={() => applyStart(createBlankTheme("My Theme"))}
        >
          <span className="creator-start-card-icon">
            <AppIcon name="plus" size={17} />
          </span>
          <strong>Start blank</strong>
          <span>A calm, modern base with sensible defaults. Change only what you want.</span>
        </button>
        <button
          type="button"
          className="creator-start-card"
          onClick={() => {
            const next = activeDesign
              ? duplicateThemeDesign(activeDesign)
              : designFromBuiltin(interfaceTheme, appearance);
            applyStart(next);
          }}
        >
          <span className="creator-start-card-icon">
            <AppIcon name="copy" size={17} />
          </span>
          <strong>Copy current look</strong>
          <span>Use {activeThemeName} as a starting point. The original stays unchanged.</span>
        </button>
        <button
          type="button"
          className="creator-start-card"
          onClick={() => {
            const next = designFromBuiltin("windows", appearance);
            next.name = "Windows Look";
            applyStart(next);
          }}
        >
          <span className="creator-start-card-icon">
            <AppIcon name="appWindow" size={17} />
          </span>
          <strong>Windows inspired</strong>
          <span>Fluent surfaces, Explorer rhythm, and a familiar command bar.</span>
        </button>
        <button
          type="button"
          className="creator-start-card"
          onClick={() => {
            const next = designFromBuiltin("finder", appearance);
            next.name = "Finder Look";
            applyStart(next);
          }}
        >
          <span className="creator-start-card-icon">
            <AppIcon name="folder" size={17} />
          </span>
          <strong>macOS inspired</strong>
          <span>Source-list calm, rounded controls, and Finder-style spacing.</span>
        </button>
        <button
          type="button"
          className="creator-start-card"
          onClick={() => {
            const next = designFromPreset(presetById("glass") ?? THEME_PRESETS[0]);
            applyStart(next);
          }}
        >
          <span className="creator-start-card-icon">
            <AppIcon name="grid" size={17} />
          </span>
          <strong>Visual preset</strong>
          <span>Jump into a polished look, then make it personal.</span>
        </button>
        <button
          type="button"
          className="creator-start-card"
          onClick={() => {
            const next = designFromPreset(presetById("high-contrast") ?? THEME_PRESETS[0]);
            applyStart(next);
          }}
        >
          <span className="creator-start-card-icon">
            <AppIcon name="eye" size={17} />
          </span>
          <strong>Accessible by design</strong>
          <span>Start with strong contrast and clear, visible boundaries.</span>
        </button>
      </div>

      <div className="creator-start-subhead">
        <h3>Choose a colour palette</h3>
        <span>One click starts a coordinated theme</span>
      </div>
      <div className="creator-palette-strip">
        {READY_PALETTES.map((palette) => (
          <button
            type="button"
            key={palette.id}
            className="creator-palette-chip"
            onClick={() => {
              const next = applyPalette(
                createBlankTheme(`${palette.name} Theme`),
                palette.palette,
                palette.appearance,
              );
              applyStart(next);
            }}
          >
            <span className="creator-palette-swatch" aria-hidden="true">
              <i style={{ background: palette.palette.sidebar }} />
              <i style={{ background: palette.palette.surface }} />
              <i style={{ background: palette.palette.accent }} />
              <i style={{ background: palette.palette.text }} />
            </span>
            <strong>{palette.name}</strong>
            <small>{palette.appearance}</small>
          </button>
        ))}
      </div>

      <div className="creator-start-subhead">
        <h3>Or start from a ready-made template</h3>
        <span>{THEME_PRESETS.length} professional starting points</span>
      </div>
      <div className="creator-template-strip">
        {THEME_PRESETS.slice(0, 6).map((preset) => (
          <button
            type="button"
            key={preset.id}
            className="creator-template-card"
            onClick={() => applyStart(designFromPreset(preset))}
          >
            <ThemePreview
              design={{
                ...designFromPreset(preset),
                name: preset.name,
              }}
              iconPack={iconPackForId(iconPacks, preset.iconPackId ?? activeIconPackId)}
              mini
            />
            <span>{preset.name}</span>
          </button>
        ))}
      </div>

      <div className="creator-ai-box">
        <span className="creator-ai-icon">
          <AppIcon name="star" size={16} />
        </span>
        <div className="creator-ai-copy">
          <strong>Describe the look you want</strong>
          <p>
            Optional: type an idea like “a dark theme with deep blue backgrounds and subtle cyan
            highlights”. MAXplorer’s built-in style matcher works offline — no account or API key.
          </p>
          <div className="creator-ai-row">
            <input
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runDescription();
              }}
              placeholder="e.g. Minimal black theme with soft monochrome icons"
              aria-label="Describe your theme"
            />
            <button
              type="button"
              className="dialog-button primary"
              disabled={!aiPrompt.trim() || aiBusy}
              onClick={() => void runDescription()}
            >
              {aiBusy ? "Creating…" : "Create preview"}
            </button>
          </div>
          {aiSummary ? <p className="creator-ai-summary">{aiSummary}</p> : null}
        </div>
      </div>
    </div>
  );

  const renderName = () => (
    <div className="creator-form">
      <h3 className="theme-creator-heading">Give your theme a name</h3>
      <p className="theme-creator-lead">
        This is how it will appear in Your themes. You can skip the optional information and
        change everything later.
      </p>
      <label className="creator-field">
        <span>Theme name</span>
        <input
          type="text"
          value={design.name}
          maxLength={60}
          autoFocus
          aria-invalid={!nameValid}
          onChange={(event) => update({ name: event.target.value })}
          onBlur={() => {
            if (!design.name.trim()) update({ name: "My Theme" });
          }}
        />
        {!nameValid ? <small>Please enter a name, or leave it as My Theme.</small> : null}
      </label>
      <label className="creator-field">
        <span>
          Description <span className="creator-optional">(optional)</span>
        </span>
        <textarea
          value={design.description}
          maxLength={200}
          placeholder="A short note about the mood or colours."
          onChange={(event) => update({ description: event.target.value })}
        />
      </label>
      <label className="creator-field">
        <span>
          Author <span className="creator-optional">(optional)</span>
        </span>
        <input
          type="text"
          value={design.author}
          maxLength={60}
          placeholder="Your name"
          onChange={(event) => update({ author: event.target.value })}
        />
      </label>
      {isAdvanced ? (
        <div className="creator-field">
          <span className="creator-field-label">Package identifier</span>
          <span className="creator-package-id">
            <AppIcon name="lock" size={11} />
            {design.packageId}
          </span>
          <small>
            Generated automatically. It keeps your theme unique when you install it on another Mac.
          </small>
        </div>
      ) : null}
      <div className="appearance-note">
        <AppIcon name="info" size={13} />
        <span>Only the name is required. Description and author are optional.</span>
      </div>
    </div>
  );

  const renderLook = () => (
    <div>
      <h3 className="theme-creator-heading">Choose your look</h3>
      <p className="theme-creator-lead">
        Pick a starting point. This changes colours and style together; your theme name stays the
        same. You can fine-tune everything in the next steps.
      </p>
      <div className="creator-look-grid" role="group" aria-label="Ready-made looks">
        {THEME_PRESETS.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={`creator-look-card ${design.presetId === preset.id ? "active" : ""}`}
            aria-pressed={design.presetId === preset.id}
            onClick={() => choosePreset(preset.id)}
          >
            <span className="creator-look-preview">
              <ThemePreview
                design={{
                  ...designFromPreset(preset, { name: preset.name }),
                  name: preset.name,
                }}
                iconPack={iconPackForId(iconPacks, preset.iconPackId ?? activeIconPackId)}
                mini
              />
            </span>
            <span className="creator-look-name">
              {preset.name}
              {design.presetId === preset.id ? <AppIcon name="check" size={11} /> : null}
            </span>
            <span className="creator-look-description">{preset.description}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderColours = () => (
    <div className="creator-form">
      <h3 className="theme-creator-heading">Choose your colours</h3>
      <p className="theme-creator-lead">
        Pick a ready-made palette or change the accent. MAXplorer can generate a coordinated set
        of backgrounds and readable text for you.
      </p>

      <div className="creator-section-block">
        <h3>Light or dark</h3>
        <div className="creator-appearance-row">
          <div className="creator-segmented" role="group" aria-label="Appearance">
            {(["light", "dark"] as const).map((option) => (
              <button
                type="button"
                key={option}
                className={design.appearance === option ? "active" : ""}
                aria-pressed={design.appearance === option}
                onClick={() => {
                  const generated = generateMatchingPalette(design.palette.accent, option);
                  commit({
                    ...design,
                    appearance: option,
                    presetId: null,
                    palette: { ...generated, selection: design.palette.accent },
                    updatedAt: new Date().toISOString(),
                  });
                }}
              >
                {option === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          <span className="creator-section-hint" style={{ margin: 0 }}>
            Both choices are fully designed; switch at any time.
          </span>
        </div>
      </div>

      <div className="creator-section-block">
        <h3>Ready-made palettes</h3>
        <div className="creator-palette-grid">
          {READY_PALETTES.map((palette) => (
            <button
              type="button"
              key={palette.id}
              className={`creator-palette-option ${
                design.appearance === palette.appearance &&
                design.palette.accent.toLowerCase() === palette.palette.accent.toLowerCase()
                  ? "active"
                  : ""
              }`}
              title={palette.name}
              onClick={() => {
                commit({
                  ...design,
                  appearance: palette.appearance,
                  palette: { ...palette.palette },
                  presetId: null,
                  updatedAt: new Date().toISOString(),
                });
              }}
            >
              <span className="creator-palette-swatch" aria-hidden="true">
                <i style={{ background: palette.palette.sidebar }} />
                <i style={{ background: palette.palette.surface }} />
                <i style={{ background: palette.palette.accent }} />
                <i style={{ background: palette.palette.text }} />
              </span>
              <small>{palette.name}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="creator-section-block">
        <h3>Your colours</h3>
        <div className="creator-color-grid">
          <ColorField
            label="Accent"
            value={design.palette.accent}
            onChange={(value) =>
              updatePalette({ accent: value, selection: value })
            }
          />
          <ColorField
            label="Selection"
            value={design.palette.selection}
            onChange={(value) => updatePalette({ selection: value })}
          />
          <ColorField
            label="Background"
            value={design.palette.background}
            onChange={(value) => updatePalette({ background: value })}
          />
          <ColorField
            label="Main panel"
            value={design.palette.surface}
            onChange={(value) => updatePalette({ surface: value })}
          />
          <ColorField
            label="Sidebar"
            value={design.palette.sidebar}
            onChange={(value) => updatePalette({ sidebar: value })}
          />
          <ColorField
            label="Text"
            value={design.palette.text}
            onChange={(value) => updatePalette({ text: value })}
          />
        </div>
        <div className="creator-inline-actions" style={{ marginTop: 10 }}>
          <button type="button" className="appearance-secondary-button" onClick={autoColours}>
            <AppIcon name="palette" size={13} />
            Auto Generate Matching Colours
          </button>
          <button type="button" className="appearance-ghost-button" onClick={resetColours}>
            <AppIcon name="refresh" size={12} />
            Reset colours
          </button>
        </div>
        <p className="creator-section-hint">
          The matching option derives backgrounds, menus, borders, and readable secondary text
          from your accent.
        </p>
        <div className={`creator-contrast ${contrastGood ? "good" : "warn"}`}>
          <AppIcon name={contrastGood ? "checkCircle" : "warning"} size={14} />
          <span>
            {contrastGood
              ? `Text contrast is ${contrast.toFixed(1)}:1 — easy to read.`
              : `Text contrast is only ${contrast.toFixed(1)}:1 on the main panel. Try a lighter or darker text colour.`}
          </span>
          {!contrastGood ? (
            <button type="button" className="appearance-secondary-button" onClick={fixContrast}>
              Fix automatically
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  const renderStyle = () => (
    <div className="creator-form">
      <h3 className="theme-creator-heading">Choose your style</h3>
      <p className="theme-creator-lead">
        These choices shape the whole interface. The preview updates immediately, and every
        setting has a safe default.
      </p>
      <StyleChoice
        label="Corners"
        value={design.style.corners}
        options={[
          {
            value: "square",
            label: "Square",
            hint: "Crisp, technical edges",
            demo: <span style={{ width: 22, height: 22, border: "1px solid var(--text-2)", borderRadius: 2 }} />,
          },
          {
            value: "soft",
            label: "Soft",
            hint: "Gently rounded",
            demo: <span style={{ width: 22, height: 22, border: "1px solid var(--text-2)", borderRadius: 7 }} />,
          },
          {
            value: "rounded",
            label: "Rounded",
            hint: "Friendly and fluid",
            demo: <span style={{ width: 22, height: 22, border: "1px solid var(--text-2)", borderRadius: 12 }} />,
          },
        ]}
        onChange={(value) => updateStyle("corners", value)}
      />
      <StyleChoice
        label="Spacing"
        value={design.style.density}
        options={[
          {
            value: "compact",
            label: "Compact",
            hint: "More items on screen",
            demo: <span style={{ width: 24, height: 16, borderTop: "2px solid var(--text-2)", borderBottom: "2px solid var(--text-3)" }} />,
          },
          {
            value: "comfortable",
            label: "Comfortable",
            hint: "Balanced everyday layout",
            demo: <span style={{ width: 24, height: 22, borderTop: "2px solid var(--text-2)", borderBottom: "2px solid var(--text-3)" }} />,
          },
          {
            value: "spacious",
            label: "Spacious",
            hint: "Extra breathing room",
            demo: <span style={{ width: 24, height: 28, borderTop: "2px solid var(--text-2)", borderBottom: "2px solid var(--text-3)" }} />,
          },
        ]}
        onChange={(value) => updateStyle("density", value)}
      />
      <StyleChoice
        label="Borders"
        value={design.style.borders}
        options={[
          {
            value: "minimal",
            label: "Minimal",
            hint: "Quiet separation",
            demo: <span style={{ width: 24, height: 20, border: "1px solid var(--border)" }} />,
          },
          {
            value: "subtle",
            label: "Subtle",
            hint: "Visible but calm",
            demo: <span style={{ width: 24, height: 20, border: "1px solid var(--border-strong)" }} />,
          },
          {
            value: "prominent",
            label: "Prominent",
            hint: "Strong, clear edges",
            demo: <span style={{ width: 24, height: 20, border: "2px solid var(--text-2)" }} />,
          },
        ]}
        onChange={(value) => updateStyle("borders", value)}
      />
      <StyleChoice
        label="Surfaces"
        value={design.style.elevation}
        options={[
          {
            value: "flat",
            label: "Flat",
            hint: "Clean and understated",
            demo: <span style={{ width: 24, height: 20, background: "var(--surface-3)", border: "1px solid var(--border)" }} />,
          },
          {
            value: "elevated",
            label: "Elevated",
            hint: "Soft, dimensional layers",
            demo: <span style={{ width: 24, height: 20, background: "var(--surface-raised)", boxShadow: "0 4px 10px rgba(0,0,0,.28)", border: "1px solid var(--border)" }} />,
          },
        ]}
        onChange={(value) => updateStyle("elevation", value)}
      />
      <StyleChoice
        label="Icon size"
        value={design.style.iconSize}
        options={[
          { value: "small", label: "Small", hint: "More compact chrome", demo: <AppIcon name="folder" size={12} /> },
          { value: "default", label: "Medium", hint: "The balanced default", demo: <AppIcon name="folder" size={16} /> },
          { value: "large", label: "Large", hint: "Easier to target", demo: <AppIcon name="folder" size={21} /> },
        ]}
        onChange={(value) => updateStyle("iconSize", value)}
      />
      <StyleChoice
        label="Text size"
        value={design.style.textSize}
        options={[
          { value: "small", label: "Small", hint: "Fits more text", demo: <span style={{ fontSize: 9, fontWeight: 700 }}>Aa</span> },
          { value: "default", label: "Default", hint: "Comfortable reading", demo: <span style={{ fontSize: 12, fontWeight: 700 }}>Aa</span> },
          { value: "large", label: "Large", hint: "Extra legibility", demo: <span style={{ fontSize: 15, fontWeight: 700 }}>Aa</span> },
        ]}
        onChange={(value) => updateStyle("textSize", value)}
      />
      <StyleChoice
        label="Sidebar"
        value={design.style.sidebar}
        options={[
          { value: "plain", label: "Plain", hint: "A quiet panel", demo: <span style={{ width: 11, height: 22, background: "var(--surface-2)", border: "1px solid var(--border)" }} /> },
          { value: "tinted", label: "Tinted", hint: "A hint of accent", demo: <span style={{ width: 11, height: 22, background: "var(--accent-soft)", border: "1px solid var(--border)" }} /> },
          { value: "contrast", label: "Contrast", hint: "Clearly separated", demo: <span style={{ width: 11, height: 22, background: "var(--surface-3)", borderRight: "2px solid var(--text-2)" }} /> },
        ]}
        onChange={(value) => updateStyle("sidebar", value)}
      />
      <StyleChoice
        label="Toolbar"
        value={design.style.toolbar}
        options={[
          { value: "flat", label: "Flat", hint: "Blends into the window", demo: <span style={{ width: 24, height: 9, background: "var(--surface)" }} /> },
          { value: "subtle", label: "Subtle", hint: "A gentle distinction", demo: <span style={{ width: 24, height: 9, background: "var(--surface-2)" }} /> },
          { value: "elevated", label: "Elevated", hint: "A raised command row", demo: <span style={{ width: 24, height: 9, background: "var(--surface-raised)", boxShadow: "0 2px 5px rgba(0,0,0,.24)" }} /> },
        ]}
        onChange={(value) => updateStyle("toolbar", value)}
      />
      <div className="creator-inline-actions">
        <button type="button" className="appearance-ghost-button" onClick={resetStyle}>
          <AppIcon name="refresh" size={12} />
          Reset style
        </button>
        {confirmResetAll ? (
          <span className="appearance-confirm-inline">
            <span>Reset the entire design?</span>
            <button
              type="button"
              onClick={() => {
                const fresh = createBlankTheme(design.name || "My Theme");
                setConfirmResetAll(false);
                applyStart(fresh);
              }}
            >
              Reset
            </button>
            <button type="button" className="keep" onClick={() => setConfirmResetAll(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="appearance-ghost-button"
            onClick={() => setConfirmResetAll(true)}
          >
            <AppIcon name="warning" size={12} />
            Reset entire design
          </button>
        )}
      </div>
    </div>
  );

  const renderIcons = () => (
    <div className="creator-form">
      <h3 className="theme-creator-heading">Choose your icons</h3>
      <p className="theme-creator-lead">
        Icons are optional and independent from colours. You can use the application icon pack,
        pick another installed pack, or change this later in Appearance.
      </p>
      <div className="creator-pack-grid" role="group" aria-label="Icon packs">
        <button
          type="button"
          className={`creator-pack-preview ${design.iconPackId === null ? "active" : ""}`}
          aria-pressed={design.iconPackId === null}
          onClick={() => update({ iconPackId: null })}
        >
          <span className="creator-pack-preview-glyphs">
            <FolderIcon size={19} />
            <AppIcon name="fileText" size={16} />
          </span>
          <span className="creator-pack-preview-copy">
            <strong>Follow MAXplorer</strong>
            <span>Use the icon pack chosen in Appearance.</span>
          </span>
        </button>
        {iconPacks.map((pack) => (
          <button
            type="button"
            key={pack.id}
            className={`creator-pack-preview ${design.iconPackId === pack.id ? "active" : ""}`}
            aria-pressed={design.iconPackId === pack.id}
            onClick={() => update({ iconPackId: pack.id })}
          >
            <span
              className="creator-pack-preview-glyphs"
              style={iconPackCssVariables(pack) as CSSProperties}
            >
              <FolderIcon size={19} />
              <AppIcon name="fileImage" size={16} strokeWidth={pack.strokeWidth} />
            </span>
            <span className="creator-pack-preview-copy">
              <strong>{pack.name}</strong>
              <span>{pack.description}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="creator-section-block">
        <h3>Preview icons</h3>
        <PackSamples pack={packForDesign} />
      </div>
      <div className="appearance-note">
        <AppIcon name="info" size={13} />
        <span>
          You do not need to customise icons to save. The default pack already matches every
          built-in theme.
        </span>
      </div>
    </div>
  );

  const renderPreview = () => (
    <div className="creator-preview-large">
      <h3 className="theme-creator-heading">Preview and save</h3>
      <p className="theme-creator-lead">
        This is the complete interface with your design applied. Check list, grid, menus, and
        dual-pane mode, then save when it feels right.
      </p>
      <div className="creator-preview-toolbar">
        <div className="creator-segmented" role="group" aria-label="Preview view">
          <button
            type="button"
            className={view === "list" ? "active" : ""}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            File list
          </button>
          <button
            type="button"
            className={view === "grid" ? "active" : ""}
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            Grid
          </button>
        </div>
        <button
          type="button"
          className={`creator-preview-control ${dualPane ? "active" : ""}`}
          aria-pressed={dualPane}
          onClick={() => setDualPane((value) => !value)}
        >
          <AppIcon name="columns" size={12} />
          Dual pane
        </button>
        <button
          type="button"
          className={`creator-preview-control ${showContextMenu ? "active" : ""}`}
          aria-pressed={showContextMenu}
          onClick={() => setShowContextMenu((value) => !value)}
        >
          <AppIcon name="more" size={12} />
          Context menu
        </button>
      </div>
      <ThemePreview
        design={design}
        iconPack={packForDesign}
        view={view}
        dualPane={dualPane}
        showContextMenu={showContextMenu}
      />
      <div className="creator-summary">
        <div className="creator-summary-item">
          <small>Look</small>
          <strong>{presetById(design.presetId)?.name ?? "Custom design"}</strong>
        </div>
        <div className="creator-summary-item">
          <small>Appearance</small>
          <strong>{design.appearance}</strong>
        </div>
        <div className="creator-summary-item">
          <small>Accent</small>
          <strong style={{ fontFamily: "ui-monospace, monospace", textTransform: "none" }}>
            {design.palette.accent}
          </strong>
        </div>
        <div className="creator-summary-item">
          <small>Style</small>
          <strong>
            {design.style.corners}, {design.style.density}
          </strong>
        </div>
        <div className="creator-summary-item">
          <small>Icons</small>
          <strong>{packForDesign.name}</strong>
        </div>
        <div className="creator-summary-item">
          <small>Package</small>
          <strong style={{ fontFamily: "ui-monospace, monospace", fontSize: 9.5, textTransform: "none" }}>
            {design.packageId}
          </strong>
        </div>
      </div>
      {validation.issues.length ? (
        <div className="creator-issues">
          {validation.issues.map((issue) => (
            <div className="creator-issue" key={issue.message}>
              <AppIcon name={issue.level === "error" ? "warning" : "info"} size={13} />
              <span>{issue.message}</span>
              {issue.repair === "text" ? (
                <button type="button" className="appearance-secondary-button" onClick={fixContrast}>
                  Fix contrast
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="creator-contrast good">
          <AppIcon name="checkCircle" size={14} />
          <span>Everything checks out. Your theme is ready to save.</span>
        </div>
      )}
      {isAdvanced ? (
        <div className="creator-section-block creator-advanced-section">
          <h3>Design tokens</h3>
          <p className="creator-section-hint">
            These are the exact values MAXplorer will use. Leave a value blank to return to the
            generated colour. Unsupported tokens are ignored on import.
          </p>
          <EffectiveTokenEditor design={design} onChange={(next) => commit(next)} />
          <div className="creator-inline-actions">
            <button
              type="button"
              className="appearance-ghost-button"
              onClick={() => commit({ ...design, overrides: {}, updatedAt: new Date().toISOString() })}
            >
              <AppIcon name="refresh" size={12} />
              Reset token overrides
            </button>
          </div>
          <div className="creator-advanced-note">
            <strong>Package validation</strong>
            <br />
            Format: maxplorer.theme v1 · Identifier: {design.packageId} · Version: {design.version}
            <br />
            {validation.issues.length === 0
              ? "No validation issues."
              : validation.issues.map((issue) => issue.message).join(" · ")}
          </div>
        </div>
      ) : null}
    </div>
  );

  const content = savedDesign
    ? null
    : step === 0
      ? renderStart()
      : step === 1
        ? renderName()
        : step === 2
          ? renderLook()
          : step === 3
            ? renderColours()
            : step === 4
              ? renderStyle()
              : step === 5
                ? renderIcons()
                : renderPreview();

  return (
    <div
      className="theme-creator-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="theme-creator"
        role="dialog"
        aria-modal="true"
        aria-label="Theme Creator"
        ref={modalRef}
      >
        <div className="theme-creator-titlebar">
          <span className="theme-creator-titlebar-icon">
            <AppIcon name="palette" size={17} />
          </span>
          <div className="theme-creator-title-copy">
            <h2>Theme Creator</h2>
            <p>
              {savedDesign
                ? "Saved and ready to share"
                : step === 0
                  ? "Pick a starting point — it takes one click"
                  : `${currentStepLabel} · Saved automatically as a draft`}
            </p>
          </div>
          <div className="theme-creator-mode" role="group" aria-label="Customisation mode">
            <button
              type="button"
              className={!isAdvanced ? "active" : ""}
              aria-pressed={!isAdvanced}
              onClick={() => setMode("simple")}
            >
              Simple
            </button>
            <button
              type="button"
              className={isAdvanced ? "active" : ""}
              aria-pressed={isAdvanced}
              onClick={() => setMode("advanced")}
            >
              Advanced
            </button>
          </div>
          <button
            type="button"
            className="theme-creator-icon-button"
            onClick={undo}
            disabled={historyIndex === 0 || Boolean(savedDesign)}
            aria-label="Undo"
            title="Undo"
          >
            <AppIcon name="undo" size={15} />
          </button>
          <button
            type="button"
            className="theme-creator-icon-button"
            onClick={redo}
            disabled={historyIndex >= history.length - 1 || Boolean(savedDesign)}
            aria-label="Redo"
            title="Redo"
          >
            <AppIcon name="forward" size={15} />
          </button>
          <button type="button" className="modal-close" aria-label="Close Theme Creator" onClick={close}>
            <AppIcon name="close" size={12} />
          </button>
        </div>

        <div className="theme-creator-body">
          {savedDesign ? null : (
            <nav className="theme-creator-rail" aria-label="Theme creator steps">
              <span className="theme-creator-rail-label">
                {step === 0 ? "Get started" : currentStepLabel}
              </span>
              {STEPS.map((entry, index) => {
                const number = index + 1;
                const active = step === number;
                const done = completed.has(number);
                return (
                  <button
                    type="button"
                    key={entry.key}
                    className={`theme-creator-step ${active ? "active" : ""} ${done && !active ? "done" : ""}`}
                    aria-current={active ? "step" : undefined}
                    disabled={step === 0 && number > 1 ? true : step > 0 && number !== 1 && !nameValid}
                    onClick={() => {
                      if (step === 0) {
                        if (number === 1) go(1);
                        return;
                      }
                      if (number === 1 || nameValid) go(number);
                    }}
                  >
                    <span className="theme-creator-step-number">
                      {done && !active ? <AppIcon name="check" size={10} /> : number}
                    </span>
                    <span className="theme-creator-step-copy">
                      <strong>{entry.title}</strong>
                      <span>{entry.subtitle}</span>
                    </span>
                  </button>
                );
              })}
              <div className="theme-creator-rail-footer">
                {isAdvanced
                  ? "Advanced Mode exposes design tokens. Your changes stay compatible with every MAXplorer release."
                  : "Simple Mode. Switch to Advanced any time without losing a single change."}
              </div>
            </nav>
          )}

          <div className="theme-creator-main">
            <div className="theme-creator-scroll">
              {savedDesign ? (
                <div className="creator-saved">
                  <span className="creator-saved-icon">
                    <AppIcon name="check" size={28} />
                  </span>
                  <h2>Your theme is saved</h2>
                  <p>
                    {savedDesign.name} is active and available in Your themes. It is a valid,
                    installable MAXplorer theme package.
                  </p>
                  <div className="creator-saved-preview">
                    <ThemePreview
                      design={savedDesign}
                      iconPack={iconPackForId(iconPacks, savedDesign.iconPackId ?? activeIconPackId)}
                    />
                  </div>
                  {savedPath ? <span className="creator-saved-path">{savedPath}</span> : null}
                  <div className="creator-saved-actions">
                    <button type="button" className="appearance-primary-button" onClick={() => void exportSaved()}>
                      <AppIcon name="downloads" size={14} />
                      Export .maxTheme
                    </button>
                    <button type="button" className="appearance-secondary-button" onClick={() => void shareSaved()}>
                      <AppIcon name="share" size={14} />
                      Share
                    </button>
                    <button type="button" className="appearance-secondary-button" onClick={continueEditing}>
                      <AppIcon name="rename" size={14} />
                      Continue customising
                    </button>
                    <button type="button" className="appearance-secondary-button" onClick={duplicateSaved}>
                      <AppIcon name="copy" size={14} />
                      Duplicate
                    </button>
                    <button type="button" className="appearance-ghost-button" onClick={startAnother}>
                      Create another theme
                    </button>
                  </div>
                </div>
              ) : (
                <div className={showPreviewColumn ? "theme-creator-layout" : undefined}>
                  <div className="theme-creator-content">{content}</div>
                  {previewColumn}
                </div>
              )}
            </div>

            <div className="theme-creator-footer">
              {savedDesign ? (
                <>
                  <span className="theme-creator-footer-status">
                    Saved · {savedDesign.author ? `by ${savedDesign.author}` : "Your theme library"}
                  </span>
                  <SaveButton onClick={close} primary>
                    Done
                  </SaveButton>
                </>
              ) : (
                <>
                  <span className="theme-creator-footer-status">
                    {step === 0
                      ? "Choose a starting point to continue."
                      : validation.issues.length
                        ? validation.issues[0].message
                        : "Draft saved automatically. You can close and return later."}
                  </span>
                  {step > 0 ? (
                    <SaveButton onClick={() => go(Math.max(1, step - 1))} disabled={step <= 1}>
                      Back
                    </SaveButton>
                  ) : (
                    <SaveButton onClick={close}>Cancel</SaveButton>
                  )}
                  {step > 0 ? (
                    <SaveButton onClick={close}>Cancel</SaveButton>
                  ) : null}
                  {step > 0 && step < 6 ? (
                    <SaveButton onClick={saveNow} disabled={!canSave}>
                      Save now
                    </SaveButton>
                  ) : null}
                  {step > 0 && step < 6 ? (
                    <SaveButton onClick={() => go(step + 1)} primary disabled={step === 1 && !nameValid}>
                      Continue
                    </SaveButton>
                  ) : null}
                  {step === 6 ? (
                    <>
                      <SaveButton onClick={() => go(4)}>Continue customising</SaveButton>
                      <SaveButton onClick={saveNow} primary disabled={!canSave}>
                        Save Theme
                      </SaveButton>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
