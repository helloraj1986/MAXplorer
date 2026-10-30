import type { CSSProperties } from "react";
import { AppIcon, type AppIconName } from "../icons/AppIcon";
import { FolderIcon } from "../icons/FolderIcon";
import { iconPackCssVariables, baseFolderCssVariables, themeCssVariables } from "../../lib/appearance/tokens";
import type { IconPack, ThemeDesign } from "../../lib/appearance/model";

interface ThemePreviewProps {
  design: ThemeDesign;
  iconPack?: IconPack | null;
  view?: "list" | "grid";
  dualPane?: boolean;
  showContextMenu?: boolean;
  mini?: boolean;
  className?: string;
}

interface PreviewRow {
  name: string;
  type: string;
  date: string;
  size: string;
  kind: "folder" | "image" | "text" | "archive" | "pdf" | "app";
  selected?: boolean;
}

const ROWS: PreviewRow[] = [
  { name: "Projects", type: "Folder", date: "Today, 09:42", size: "—", kind: "folder", selected: true },
  { name: "Design System.fig", type: "Figma document", date: "Today, 09:18", size: "2.4 MB", kind: "image" },
  { name: "Product Notes.md", type: "Markdown", date: "Yesterday", size: "18 KB", kind: "text" },
  { name: "Brand Assets", type: "Folder", date: "Yesterday", size: "—", kind: "folder" },
  { name: "launch-hero.png", type: "PNG image", date: "12 Oct 2026", size: "4.1 MB", kind: "image" },
  { name: "Research.pdf", type: "PDF document", date: "08 Oct 2026", size: "1.2 MB", kind: "pdf" },
  { name: "Archive.zip", type: "ZIP archive", date: "02 Oct 2026", size: "860 KB", kind: "archive" },
  { name: "MAXplorer.app", type: "Application", date: "28 Sep 2026", size: "18 MB", kind: "app" },
];

const KIND_ICONS: Record<PreviewRow["kind"], AppIconName> = {
  folder: "folder",
  image: "fileImage",
  text: "fileText",
  archive: "fileArchive",
  pdf: "pdf",
  app: "appWindow",
};

const KIND_COLORS: Record<PreviewRow["kind"], string> = {
  folder: "var(--accent)",
  image: "var(--file-accent-image)",
  text: "var(--file-accent-text)",
  archive: "var(--file-accent-archive)",
  pdf: "var(--file-accent-pdf)",
  app: "var(--file-accent-app)",
};

function FolderArtwork({ size = 18 }: { size?: number }) {
  return <FolderIcon size={size} variant="standard" />;
}

function RowGlyph({ row, size = 17 }: { row: PreviewRow; size?: number }) {
  if (row.kind === "folder") return <FolderArtwork size={size} />;
  return (
    <AppIcon
      name={KIND_ICONS[row.kind]}
      size={size}
      strokeWidth={1.65}
      style={{ color: KIND_COLORS[row.kind] }}
    />
  );
}

function WindowControls({ finder }: { finder: boolean }) {
  if (finder) {
    return (
      <span className="tp-traffic" aria-hidden="true">
        <i className="tp-traffic-close" />
        <i className="tp-traffic-min" />
        <i className="tp-traffic-max" />
      </span>
    );
  }
  return (
    <span className="tp-caption" aria-hidden="true">
      <i />
      <i />
      <i className="tp-caption-close" />
    </span>
  );
}

function Toolbar() {
  const commands: Array<{ icon: AppIconName; label: string; primary?: boolean }> = [
    { icon: "new", label: "New", primary: true },
    { icon: "cut", label: "Cut" },
    { icon: "copy", label: "Copy" },
    { icon: "paste", label: "Paste" },
    { icon: "rename", label: "Rename" },
    { icon: "share", label: "Share" },
    { icon: "delete", label: "Delete" },
  ];
  return (
    <div className="tp-commandbar">
      {commands.map((command) => (
        <span
          key={command.label}
          className={`tp-command ${command.primary ? "tp-command-primary" : ""}`}
        >
          <AppIcon name={command.icon} size={13} strokeWidth={1.7} />
          <span>{command.label}</span>
        </span>
      ))}
      <span className="tp-command-spacer" />
      <span className="tp-command tp-command-icon" aria-hidden="true">
        <AppIcon name="view" size={13} />
      </span>
      <span className="tp-command tp-command-icon" aria-hidden="true">
        <AppIcon name="more" size={13} />
      </span>
    </div>
  );
}

function Navigation() {
  return (
    <div className="tp-navbar">
      <span className="tp-nav-button" aria-hidden="true">
        <AppIcon name="back" size={13} />
      </span>
      <span className="tp-nav-button tp-nav-button-muted" aria-hidden="true">
        <AppIcon name="forward" size={13} />
      </span>
      <span className="tp-nav-button" aria-hidden="true">
        <AppIcon name="up" size={13} />
      </span>
      <span className="tp-address">
        <FolderArtwork size={13} />
        <span>Home</span>
        <AppIcon name="chevronRight" size={10} className="tp-crumb-separator" />
        <span>Projects</span>
        <AppIcon name="chevronRight" size={10} className="tp-crumb-separator" />
        <strong>MAXplorer</strong>
      </span>
      <span className="tp-search">
        <AppIcon name="search" size={12} />
        <span>Search</span>
      </span>
    </div>
  );
}

function Tabs() {
  return (
    <div className="tp-tabbar">
      <span className="tp-tab tp-tab-active">
        <FolderArtwork size={12} />
        <span>MAXplorer</span>
        <AppIcon name="close" size={9} className="tp-tab-close" />
      </span>
      <span className="tp-tab">
        <FolderArtwork size={12} />
        <span>Design System</span>
      </span>
      <span className="tp-tab-add">
        <AppIcon name="plus" size={11} />
      </span>
    </div>
  );
}

function Sidebar() {
  const items: Array<{ label: string; icon: AppIconName; active?: boolean; folder?: boolean }> = [
    { label: "Home", icon: "home", active: true },
    { label: "Desktop", icon: "desktop" },
    { label: "Documents", icon: "documents" },
    { label: "Downloads", icon: "downloads" },
    { label: "Pictures", icon: "pictures" },
  ];
  return (
    <aside className="tp-sidebar">
      <span className="tp-sidebar-heading">Quick access</span>
      {items.map((item) => (
        <span key={item.label} className={`tp-sidebar-row ${item.active ? "active" : ""}`}>
          {item.folder ? (
            <FolderArtwork size={15} />
          ) : (
            <AppIcon name={item.icon} size={14} strokeWidth={1.7} />
          )}
          <span>{item.label}</span>
        </span>
      ))}
      <span className="tp-sidebar-heading tp-sidebar-heading-spaced">This Mac</span>
      <span className="tp-sidebar-row">
        <AppIcon name="computer" size={14} />
        <span>MAXplorer</span>
      </span>
      <span className="tp-sidebar-row">
        <AppIcon name="applications" size={14} />
        <span>Applications</span>
      </span>
    </aside>
  );
}

function ListView({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`tp-list ${compact ? "compact" : ""}`}>
      <div className="tp-list-head">
        <span>Name</span>
        <span>Date modified</span>
        <span>Type</span>
        <span>Size</span>
      </div>
      {ROWS.map((row) => (
        <div key={row.name} className={`tp-list-row ${row.selected ? "selected" : ""}`}>
          <span className="tp-list-name">
            <RowGlyph row={row} size={compact ? 14 : 17} />
            <span>{row.name}</span>
          </span>
          <span className="tp-list-meta">{row.date}</span>
          <span className="tp-list-meta">{row.type}</span>
          <span className="tp-list-meta tp-list-size">{row.size}</span>
        </div>
      ))}
    </div>
  );
}

function GridView({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`tp-grid ${compact ? "compact" : ""}`}>
      {ROWS.slice(0, compact ? 6 : 8).map((row) => (
        <div key={row.name} className={`tp-grid-item ${row.selected ? "selected" : ""}`}>
          <span className="tp-grid-glyph">
            <RowGlyph row={row} size={compact ? 28 : 38} />
          </span>
          <span className="tp-grid-name">{row.name}</span>
        </div>
      ))}
    </div>
  );
}

function ContextMenu() {
  return (
    <div className="tp-menu" role="presentation">
      <span className="tp-menu-item">
        <AppIcon name="open" size={12} />
        <span>Open</span>
        <kbd>⌘O</kbd>
      </span>
      <span className="tp-menu-item">
        <AppIcon name="openWith" size={12} />
        <span>Open With</span>
        <AppIcon name="chevronRight" size={10} />
      </span>
      <span className="tp-menu-separator" />
      <span className="tp-menu-item">
        <AppIcon name="cut" size={12} />
        <span>Cut</span>
        <kbd>⌘X</kbd>
      </span>
      <span className="tp-menu-item">
        <AppIcon name="copy" size={12} />
        <span>Copy</span>
        <kbd>⌘C</kbd>
      </span>
      <span className="tp-menu-item">
        <AppIcon name="rename" size={12} />
        <span>Rename</span>
        <kbd>F2</kbd>
      </span>
      <span className="tp-menu-separator" />
      <span className="tp-menu-item tp-menu-danger">
        <AppIcon name="delete" size={12} />
        <span>Move to Trash</span>
      </span>
      <span className="tp-menu-item">
        <AppIcon name="properties" size={12} />
        <span>Get Info</span>
      </span>
    </div>
  );
}

function ContentPane({
  view,
  compact,
  showContextMenu,
}: {
  view: "list" | "grid";
  compact: boolean;
  showContextMenu: boolean;
}) {
  return (
    <div className="tp-content">
      {view === "list" ? <ListView compact={compact} /> : <GridView compact={compact} />}
      {showContextMenu ? <ContextMenu /> : null}
    </div>
  );
}

/**
 * A realistic, self-contained miniature of MAXplorer. It is rendered with the
 * exact tokens the live application will receive, which is why the preview is a
 * truthful representation rather than a decorative mockup.
 */
export function ThemePreview({
  design,
  iconPack,
  view = "list",
  dualPane = false,
  showContextMenu = false,
  mini = false,
  className,
}: ThemePreviewProps) {
  const variables: Record<string, string> = {
    ...themeCssVariables(design),
    ...(iconPack && iconPack.id !== "classic"
      ? iconPackCssVariables(iconPack)
      : baseFolderCssVariables(design.base)),
  };
  const finder = design.base === "finder";
  return (
    <div
      className={`tp-window ${mini ? "tp-mini" : ""} ${finder ? "tp-finder" : "tp-windows"} tp-text-${design.style.textSize} tp-icon-${design.style.iconSize} tp-density-${design.style.density} ${className ?? ""}`}
      style={variables as CSSProperties}
      data-ui-theme={design.base}
      data-theme={design.appearance}
      role={mini ? undefined : "img"}
      aria-label={mini ? undefined : `Preview of ${design.name}`}
      aria-hidden={mini ? true : undefined}
    >
      <div className="tp-titlebar">
        {finder ? <WindowControls finder /> : null}
        <span className="tp-window-title">
          <span className="tp-window-title-folder">
            <FolderArtwork size={11} />
          </span>
          MAXplorer — {design.name}
        </span>
        {finder ? (
          <span className="tp-titlebar-spacer" />
        ) : (
          <WindowControls finder={false} />
        )}
      </div>
      {mini ? null : <Toolbar />}
      {mini ? (
        <div className="tp-mini-nav">
          <span className="tp-address">
            <FolderArtwork size={10} />
            <span>Home</span>
            <AppIcon name="chevronRight" size={8} />
            <strong>MAXplorer</strong>
          </span>
        </div>
      ) : (
        <>
          <Navigation />
          <Tabs />
        </>
      )}
      <div className="tp-body">
        <Sidebar />
        <div className={`tp-panes ${dualPane ? "dual" : ""}`}>
          <ContentPane view={view} compact={mini} showContextMenu={!mini && showContextMenu && !dualPane} />
          {dualPane ? (
            <ContentPane view="list" compact={mini} showContextMenu={false} />
          ) : null}
        </div>
        {!mini && showContextMenu && dualPane ? <ContextMenu /> : null}
      </div>
      <div className="tp-statusbar">
        <span>{ROWS.length} items</span>
        <span className="tp-status-separator" />
        <span>1 item selected</span>
        <span className="tp-status-spacer" />
        <AppIcon name="grid" size={10} />
        <AppIcon name="list" size={10} />
      </div>
    </div>
  );
}
