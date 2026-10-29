import { useMemo, useState } from "react";
import { Icon } from "../Icon";
import { useSearchStore } from "../../state/searchStore";
import { KIND_LABELS, type SearchDateRange, type SearchFilters, type SearchKind } from "../../lib/search/types";
import { formatSizeLabel, startOfDay, startOfMonth, startOfWeek } from "../../lib/search/interpreter";

const DAY = 24 * 60 * 60 * 1000;
const KINDS: SearchKind[] = [
  "folder",
  "document",
  "pdf",
  "image",
  "video",
  "audio",
  "archive",
  "code",
  "app",
  "sheet",
  "slides",
  "text",
];

const DATE_PRESETS: Array<{ id: string; label: string; range: () => SearchDateRange | null }> = [
  { id: "any", label: "Any time", range: () => null },
  { id: "today", label: "Today", range: () => ({ after: startOfDay(new Date()), before: Date.now(), label: "Today" }) },
  {
    id: "yesterday",
    label: "Yesterday",
    range: () => {
      const start = startOfDay(new Date(Date.now() - DAY));
      return { after: start, before: start + DAY - 1, label: "Yesterday" };
    },
  },
  { id: "week", label: "Last 7 days", range: () => ({ after: Date.now() - 7 * DAY, before: Date.now(), label: "Last 7 days" }) },
  {
    id: "week-calendar",
    label: "This week",
    range: () => ({ after: startOfWeek(new Date()), before: Date.now(), label: "This week" }),
  },
  { id: "month", label: "Last 30 days", range: () => ({ after: Date.now() - 30 * DAY, before: Date.now(), label: "Last 30 days" }) },
  {
    id: "month-calendar",
    label: "This month",
    range: () => ({ after: startOfMonth(new Date()), before: Date.now(), label: "This month" }),
  },
  {
    id: "quarter",
    label: "Last 90 days",
    range: () => ({ after: Date.now() - 90 * DAY, before: Date.now(), label: "Last 90 days" }),
  },
  {
    id: "year",
    label: "This year",
    range: () => ({ after: new Date(new Date().getFullYear(), 0, 1).getTime(), before: Date.now(), label: "This year" }),
  },
];

const SIZE_PRESETS: Array<{ id: string; label: string; min: number | null; max: number | null }> = [
  { id: "any", label: "Any size", min: null, max: null },
  { id: "empty", label: "Empty files", min: null, max: 0 },
  { id: "small", label: "Under 1 MB", min: null, max: 1024 ** 2 },
  { id: "medium", label: "1 – 100 MB", min: 1024 ** 2, max: 100 * 1024 ** 2 },
  { id: "large", label: "100 MB – 1 GB", min: 100 * 1024 ** 2, max: 1024 ** 3 },
  { id: "huge", label: "Over 1 GB", min: 1024 ** 3, max: null },
];

function dateValue(range: SearchDateRange | null): string {
  if (!range) return "any";
  const match = DATE_PRESETS.find((preset) => preset.range()?.label === range.label);
  return match?.id ?? "custom";
}

function DateFilterRow({
  label,
  range,
  onChange,
}: {
  label: string;
  range: SearchDateRange | null;
  onChange: (range: SearchDateRange | null) => void;
}) {
  const [custom, setCustom] = useState(false);
  const preset = dateValue(range);
  const isCustom = custom || preset === "custom";
  const toInput = (value: number | null) => {
    if (!value) return "";
    const date = new Date(value);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  };
  return (
    <div className="search-filter-date-row">
      <span className="search-filter-label">{label}</span>
      <select
        value={isCustom ? "custom" : preset}
        onChange={(event) => {
          if (event.target.value === "custom") {
            setCustom(true);
            const start = startOfDay(new Date());
            onChange({ after: start, before: Date.now(), label: "Custom range" });
            return;
          }
          setCustom(false);
          const choice = DATE_PRESETS.find((item) => item.id === event.target.value);
          onChange(choice ? choice.range() : null);
        }}
      >
        {DATE_PRESETS.map((item) => (
          <option value={item.id} key={item.id}>
            {item.label}
          </option>
        ))}
        <option value="custom">Custom range...</option>
      </select>
      {isCustom ? (
        <div className="search-filter-date-custom">
          <input
            type="date"
            aria-label={`${label} after`}
            value={toInput(range?.after ?? null)}
            onChange={(event) => {
              const after = event.target.value ? new Date(`${event.target.value}T00:00:00`).getTime() : null;
              onChange({ after, before: range?.before ?? null, label: "Custom range" });
            }}
          />
          <span>to</span>
          <input
            type="date"
            aria-label={`${label} before`}
            value={toInput(range?.before ?? null)}
            onChange={(event) => {
              const before = event.target.value ? new Date(`${event.target.value}T23:59:59`).getTime() : null;
              onChange({ after: range?.after ?? null, before, label: "Custom range" });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SearchFilters() {
  const filters = useSearchStore((state) => state.filters);
  const applyFilters = useSearchStore((state) => state.applyFilters);
  const clearFilters = useSearchStore((state) => state.clearFilters);
  const customRoots = useSearchStore((state) => state.customRoots);
  const setCustomRoots = useSearchStore((state) => state.setCustomRoots);
  const interpretation = useSearchStore((state) => state.interpretation);
  const contentTerms = useMemo(() => interpretation?.contentTerms ?? [], [interpretation]);
  const excludeTerms = useMemo(() => interpretation?.excludeTerms ?? [], [interpretation]);
  const setContentTerms = useSearchStore((state) => state.setContentTerms);
  const setExcludeTerms = useSearchStore((state) => state.setExcludeTerms);
  const [customPath, setCustomPath] = useState("");
  const [extensionDraft, setExtensionDraft] = useState(filters.extensions.join(", "));
  const [contentDraft, setContentDraft] = useState("");
  const [excludeDraft, setExcludeDraft] = useState("");
  const [sizeMin, setSizeMin] = useState(filters.minSize ? String(Math.round(filters.minSize / 1024 ** 2)) : "");
  const [sizeMax, setSizeMax] = useState(filters.maxSize ? String(Math.round(filters.maxSize / 1024 ** 2)) : "");

  const toggleKind = (kind: SearchKind) => {
    applyFilters({
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter((item) => item !== kind)
        : [...filters.kinds, kind],
    });
  };

  const applySizePreset = (id: string) => {
    const preset = SIZE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setSizeMin(preset.min ? String(Math.round(preset.min / 1024 ** 2)) : "");
    setSizeMax(preset.max ? String(Math.round(preset.max / 1024 ** 2)) : "");
    applyFilters({ minSize: preset.min, maxSize: preset.max });
  };

  const updateSize = () => {
    const min = sizeMin.trim() ? Math.round(Number(sizeMin) * 1024 ** 2) : null;
    const max = sizeMax.trim() ? Math.round(Number(sizeMax) * 1024 ** 2) : null;
    applyFilters({
      minSize: min != null && Number.isFinite(min) ? min : null,
      maxSize: max != null && Number.isFinite(max) ? max : null,
    });
  };

  const updateExtensions = () => {
    const extensions = extensionDraft
      .split(/[,\s]+/)
      .map((value) => value.trim().replace(/^\./, "").toLowerCase())
      .filter(Boolean);
    applyFilters({ extensions });
  };

  const updateDate = (field: "modified" | "created" | "accessed", range: SearchDateRange | null) => {
    applyFilters({ [field]: range } as Partial<SearchFilters>);
  };

  return (
    <aside className="search-filters" aria-label="Search filters">
      <div className="search-filters-header">
        <h2>
          <Icon name="sort" size={14} />
          Filters
        </h2>
        <button type="button" className="link-button" onClick={clearFilters}>
          Clear all
        </button>
      </div>

      <section>
        <h3>Kind</h3>
        <div className="search-kind-grid">
          {KINDS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={`search-kind-chip ${filters.kinds.includes(kind) ? "active" : ""}`}
              aria-pressed={filters.kinds.includes(kind)}
              onClick={() => toggleKind(kind)}
            >
              {KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>Content</h3>
        <div className="search-segmented" role="group" aria-label="Content search mode">
          {(
            [
              ["both", "Name and contents"],
              ["name", "File name only"],
              ["content", "File contents only"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filters.contentMode === value ? "active" : ""}
              aria-pressed={filters.contentMode === value}
              onClick={() => applyFilters({ contentMode: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-filter-inline">
          <span>Words</span>
          <select
            value={filters.matchMode}
            onChange={(event) => applyFilters({ matchMode: event.target.value as SearchFilters["matchMode"] })}
          >
            <option value="all">All words</option>
            <option value="any">Any word</option>
            <option value="phrase">Exact phrase</option>
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.caseSensitive}
            onChange={(event) => applyFilters({ caseSensitive: event.target.checked })}
          />
          <span>Match case</span>
        </label>
        <div className="search-content-term">
          <input
            aria-label="Text that indexed contents must contain"
            placeholder="Contents contain..."
            value={contentDraft}
            spellCheck={false}
            onChange={(event) => setContentDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!contentDraft.trim()) return;
                setContentTerms([...contentTerms, contentDraft.trim()]);
                setContentDraft("");
              }
            }}
          />
          <button
            type="button"
            className="search-small-button"
            disabled={!contentDraft.trim()}
            onClick={() => {
              if (!contentDraft.trim()) return;
              setContentTerms([...contentTerms, contentDraft.trim()]);
              setContentDraft("");
            }}
          >
            Add
          </button>
        </div>
        {contentTerms.length ? (
          <div className="search-custom-list">
            {contentTerms.map((term) => (
              <span className="search-location-pill" key={term}>
                <span title={term}>Contains: {term}</span>
                <button
                  type="button"
                  aria-label={`Remove content term ${term}`}
                  onClick={() => setContentTerms(contentTerms.filter((value) => value !== term))}
                >
                  <Icon name="close" size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="search-content-term">
          <input
            aria-label="Words that results must not contain"
            placeholder="Exclude words..."
            value={excludeDraft}
            spellCheck={false}
            onChange={(event) => setExcludeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!excludeDraft.trim()) return;
                setExcludeTerms([...excludeTerms, excludeDraft.trim()]);
                setExcludeDraft("");
              }
            }}
          />
          <button
            type="button"
            className="search-small-button"
            disabled={!excludeDraft.trim()}
            onClick={() => {
              if (!excludeDraft.trim()) return;
              setExcludeTerms([...excludeTerms, excludeDraft.trim()]);
              setExcludeDraft("");
            }}
          >
            Exclude
          </button>
        </div>
        {excludeTerms.length ? (
          <div className="search-custom-list">
            {excludeTerms.map((term) => (
              <span className="search-location-pill" key={term}>
                <span title={term}>Excludes: {term}</span>
                <button
                  type="button"
                  aria-label={`Remove excluded term ${term}`}
                  onClick={() => setExcludeTerms(excludeTerms.filter((value) => value !== term))}
                >
                  <Icon name="close" size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h3>Date</h3>
        <DateFilterRow label="Modified" range={filters.modified} onChange={(range) => updateDate("modified", range)} />
        <DateFilterRow label="Created" range={filters.created} onChange={(range) => updateDate("created", range)} />
        <DateFilterRow label="Accessed" range={filters.accessed} onChange={(range) => updateDate("accessed", range)} />
      </section>

      <section>
        <h3>Size</h3>
        <div className="search-size-presets">
          {SIZE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className={`search-kind-chip ${
                filters.minSize === preset.min && filters.maxSize === preset.max ? "active" : ""
              }`}
              onClick={() => applySizePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="search-size-custom">
          <input
            aria-label="Minimum size in MB"
            inputMode="decimal"
            placeholder="Min MB"
            value={sizeMin}
            onChange={(event) => setSizeMin(event.target.value)}
            onBlur={updateSize}
          />
          <span>to</span>
          <input
            aria-label="Maximum size in MB"
            inputMode="decimal"
            placeholder="Max MB"
            value={sizeMax}
            onChange={(event) => setSizeMax(event.target.value)}
            onBlur={updateSize}
          />
        </div>
        {filters.minSize != null || filters.maxSize != null ? (
          <p className="search-filter-hint">
            {filters.minSize != null ? `At least ${formatSizeLabel(filters.minSize)}. ` : ""}
            {filters.maxSize != null ? `At most ${formatSizeLabel(filters.maxSize)}.` : ""}
          </p>
        ) : null}
      </section>

      <section>
        <h3>Location</h3>
        {filters.locations.length ? (
          <div className="search-location-list">
            {filters.locations.map((location) => (
              <span className="search-location-pill" key={location}>
                <Icon name="folder" size={12} />
                <span title={location}>{location.split(/[\\/]/).filter(Boolean).pop() ?? location}</span>
                <button
                  type="button"
                  aria-label={`Remove ${location} from filters`}
                  onClick={() => applyFilters({ locations: filters.locations.filter((item) => item !== location) })}
                >
                  <Icon name="close" size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="search-filter-hint">No extra location filters. The scope selector above controls where MAXplorer searches.</p>
        )}
        <div className="search-custom-location">
          <input
            aria-label="Add a custom search location"
            placeholder="/Users/you/Projects"
            value={customPath}
            spellCheck={false}
            onChange={(event) => setCustomPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (!customPath.trim()) return;
                setCustomRoots([...customRoots, customPath.trim()]);
                setCustomPath("");
              }
            }}
          />
          <button
            type="button"
            className="search-small-button"
            disabled={!customPath.trim()}
            onClick={() => {
              if (!customPath.trim()) return;
              setCustomRoots([...customRoots, customPath.trim()]);
              setCustomPath("");
            }}
          >
            Add
          </button>
        </div>
        {customRoots.length ? (
          <div className="search-custom-list">
            {customRoots.map((root) => (
              <span className="search-location-pill" key={root}>
                <span title={root}>{root}</span>
                <button
                  type="button"
                  aria-label={`Remove custom location ${root}`}
                  onClick={() => setCustomRoots(customRoots.filter((item) => item !== root))}
                >
                  <Icon name="close" size={9} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h3>Name</h3>
        <label className="search-filter-inline">
          <span>Extensions</span>
          <input
            placeholder="pdf, docx, ts"
            value={extensionDraft}
            spellCheck={false}
            onChange={(event) => setExtensionDraft(event.target.value)}
            onBlur={updateExtensions}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                updateExtensions();
              }
            }}
          />
        </label>
      </section>

      <section>
        <h3>Additional</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.includeHidden}
            onChange={(event) => applyFilters({ includeHidden: event.target.checked })}
          />
          <span>Hidden files</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.noExtension}
            onChange={(event) => applyFilters({ noExtension: event.target.checked })}
          />
          <span>Files without extensions</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.emptyFolders}
            onChange={(event) => applyFilters({ emptyFolders: event.target.checked })}
          />
          <span>Empty folders</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={filters.duplicatesOnly}
            onChange={(event) => applyFilters({ duplicatesOnly: event.target.checked })}
          />
          <span>Duplicate candidates</span>
        </label>
      </section>

      <p className="search-filter-hint search-filter-footer">
        Filters are applied to the real index and filesystem. Choosing a filter never changes the visible results unless
        it changes the query.
      </p>
    </aside>
  );
}
