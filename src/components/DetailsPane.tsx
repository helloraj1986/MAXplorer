import { useMemo } from "react";
import { Icon } from "./Icon";
import { FileTypeIcon } from "./icons/FileTypeIcon";
import { FolderIcon } from "./icons/FolderIcon";
import { useExplorerStore } from "../state/explorerStore";
import { basename, formatCount, formatDate, formatSize, plural, totalSize, typeName } from "../lib/format";
import { HOME_LOCATION, type PaneId } from "../lib/types";

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className="meta-value" title={value}>
        {value}
      </span>
    </div>
  );
}

export function DetailsPane({ paneId = "left" }: { paneId?: PaneId }) {
  const platform = useExplorerStore((state) => state.platform);
  const activeTab = useExplorerStore(
    (state) => state.panes[paneId].tabs.find((tab) => tab.id === state.panes[paneId].activeTabId),
  );
  const entries = activeTab?.searchResults ?? activeTab?.entries ?? [];
  const selection = useMemo(() => {
    const selected = new Set(activeTab?.selection ?? []);
    return entries.filter((entry) => selected.has(entry.path));
  }, [activeTab?.selection, entries]);
  const stats = useMemo(
    () => ({
      count: selection.length,
      bytes: selection.reduce((sum, entry) => sum + (entry.isDir ? 0 : entry.size ?? 0), 0),
      entries: selection,
    }),
    [selection],
  );
  const single = selection.length === 1 ? selection[0] : null;
  const folderName =
    activeTab?.location === HOME_LOCATION
      ? "Home"
      : basename(activeTab?.location ?? "") || activeTab?.location || "This folder";

  return (
    <aside className="details-pane" aria-label="Details pane">
      {single ? (
        <>
          <div className="details-title">{single.name}</div>
          <div className="details-subtitle">{typeName(single)}</div>
          <div className="details-thumb">
            <FileTypeIcon entry={single} size={96} thumbnail />
          </div>
          <div className="details-meta">
            {single.isSymlink && single.target ? <MetaRow label="Target" value={single.target} /> : null}
            <MetaRow label="Date modified" value={formatDate(single.modified)} />
            <MetaRow label="Date created" value={formatDate(single.created)} />
            {!single.isDir ? <MetaRow label="Size" value={formatSize(single.size)} /> : null}
            <MetaRow label="Type" value={typeName(single)} />
            <MetaRow label="Location" value={single.path} />
          </div>
        </>
      ) : selection.length > 1 ? (
        <>
          <div className="details-title">{formatCount(selection.length)} items selected</div>
          <div className="details-subtitle">{formatSize(stats.bytes)}</div>
          <div className="details-thumb multi">
            <FileTypeIcon entry={selection[0]} size={72} thumbnail />
            <FileTypeIcon entry={selection[1]} size={72} thumbnail />
          </div>
          <div className="details-selection-list">
            {selection.slice(0, 8).map((entry) => (
              <div className="details-selection-row" key={entry.path} title={entry.path}>
                <FileTypeIcon entry={entry} size={18} />
                <span>{entry.name}</span>
              </div>
            ))}
            {selection.length > 8 ? (
              <div className="details-selection-more">and {selection.length - 8} more</div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="details-title">
            {activeTab?.location === HOME_LOCATION
              ? "Home"
              : `${formatCount(entries.length)} ${plural(entries.length, "item")}`}
          </div>
          <div className="details-subtitle">
            {activeTab?.location === HOME_LOCATION ? "Quick access" : folderName}
          </div>
          <div className="details-thumb folder">
            {activeTab?.location === HOME_LOCATION ? (
              <Icon name="home" size={72} />
            ) : (
              <FolderIcon size={96} />
            )}
          </div>
          <div className="details-meta">
            <MetaRow
              label="Location"
              value={
                activeTab?.location === HOME_LOCATION
                  ? platform?.home ?? "Home"
                  : activeTab?.location ?? ""
              }
            />
            {activeTab?.location === HOME_LOCATION ? (
              <MetaRow label="Workspace" value="Quick access and recent files" />
            ) : (
              <>
                <MetaRow label="Items" value={formatCount(entries.length)} />
                {totalSize(entries) > 0 ? (
                  <MetaRow label="Total size" value={formatSize(totalSize(entries))} />
                ) : null}
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
