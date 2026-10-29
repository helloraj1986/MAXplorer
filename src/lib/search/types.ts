import type { FileEntry } from "../types";

export type SearchScopeId =
  | "current"
  | "currentRecursive"
  | "home"
  | "selected"
  | "indexed"
  | "external"
  | "custom";

export type SearchView = "list" | "grid";
export type SearchSort = "relevance" | "name" | "modified" | "created" | "size" | "kind";
export type SearchSortDirection = "asc" | "desc";
export type SearchMatchMode = "all" | "any" | "phrase";
export type SearchContentMode = "name" | "content" | "both";

export type SearchKind =
  | "folder"
  | "document"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "code"
  | "app"
  | "sheet"
  | "slides"
  | "text"
  | "font"
  | "executable"
  | "file";

export interface SearchDateRange {
  after: number | null;
  before: number | null;
  /** Human label resolved by the interpreter, e.g. "Modified: Last 7 days". */
  label?: string;
}

export interface SearchFilters {
  kinds: SearchKind[];
  extensions: string[];
  minSize: number | null;
  maxSize: number | null;
  modified: SearchDateRange | null;
  created: SearchDateRange | null;
  accessed: SearchDateRange | null;
  contentMode: SearchContentMode;
  matchMode: SearchMatchMode;
  caseSensitive: boolean;
  includeHidden: boolean;
  noExtension: boolean;
  emptyFolders: boolean;
  duplicatesOnly: boolean;
  locations: string[];
}

export interface SearchChip {
  id: string;
  group: "kind" | "extension" | "date" | "size" | "location" | "content" | "other";
  label: string;
  /** Structured value used to remove/edit the constraint. */
  value: string;
}

export interface SearchInterpretation {
  original: string;
  terms: string[];
  nameTerms: string[];
  contentTerms: string[];
  excludeTerms: string[];
  filters: SearchFilters;
  locations: string[];
  chips: SearchChip[];
  mode: SearchContentMode;
  matchMode: SearchMatchMode;
  caseSensitive: boolean;
  exactPhrase: boolean;
  wantsDuplicates: boolean;
  semanticHint: boolean;
  visualHint: boolean;
  notes: string[];
  /** The raw query with interpreted constraint phrases removed. */
  residualQuery: string;
}

export interface SearchRequestPayload {
  queryId: number;
  text: string;
  terms: string[];
  nameTerms: string[];
  contentTerms: string[];
  excludeTerms: string[];
  kinds: string[];
  extensions: string[];
  roots: string[];
  includeHidden: boolean;
  includeIndexed: boolean;
  recursive: boolean;
  includeLive: boolean;
  includeSpotlight: boolean;
  mode: SearchContentMode;
  matchMode: SearchMatchMode;
  caseSensitive: boolean;
  exactPhrase: boolean;
  minSize: number | null;
  maxSize: number | null;
  modifiedAfter: number | null;
  modifiedBefore: number | null;
  createdAfter: number | null;
  createdBefore: number | null;
  accessedAfter: number | null;
  accessedBefore: number | null;
  noExtension: boolean;
  emptyFolders: boolean;
  limit: number;
  sort: SearchSort;
  sortDirection: SearchSortDirection;
}

export interface SearchHit {
  entry: FileEntry;
  score: number;
  matchKind: "name" | "path" | "content" | "metadata" | "semantic" | string;
  snippet: string | null;
  source: "index" | "filesystem" | "spotlight" | string;
  indexed: boolean;
  explanation: string | null;
}

export interface LocationCoverage {
  path: string;
  name: string;
  status: string;
  indexedFiles: number;
  searchableFiles: number;
  lastIndexed: number | null;
  error: string | null;
}

export interface SearchStats {
  elapsedMs: number;
  indexHits: number;
  liveScanned: number;
  spotlightHits: number;
  contentHits: number;
  total: number;
  truncated: boolean;
  errors: number;
  ftsAvailable: boolean;
  indexFiles: number;
  indexContent: number;
  coverage: LocationCoverage[];
  notes: string[];
}

export interface SearchResponse {
  queryId: number;
  hits: SearchHit[];
  stats: SearchStats;
}

export interface SearchProgress {
  queryId: number;
  phase: string;
  hits: SearchHit[];
  done: boolean;
  stats: SearchStats | null;
  note: string | null;
}

export interface SearchSuggestion {
  name: string;
  path: string;
  isDir: boolean;
  kind: string;
}

export interface IndexError {
  path: string;
  message: string;
  kind: string;
  occurredAt: number | null;
}

export interface IndexStatus {
  paused: boolean;
  activity: string;
  currentPath: string | null;
  ftsAvailable: boolean;
  contentEnabled: boolean;
  maxContentBytes: number;
  dbPath: string;
  indexSizeBytes: number;
  indexedFiles: number;
  indexedFolders: number;
  searchableContent: number;
  pendingContent: number;
  failedContent: number;
  skippedContent: number;
  lastReconciliation: number | null;
  locations: LocationCoverage[];
  errors: IndexError[];
}

export interface DuplicateFile {
  entry: FileEntry;
  hash: string | null;
}

export interface DuplicateGroup {
  id: string;
  kind: string;
  files: DuplicateFile[];
  size: number;
  recoverableBytes: number;
  verified: boolean;
  explanation: string;
}

export interface DuplicateResponse {
  queryId: number;
  groups: DuplicateGroup[];
  scannedFiles: number;
  candidateFiles: number;
  hashedFiles: number;
  recoverableBytes: number;
  cancelled: boolean;
  errors: number;
  elapsedMs: number;
}

export interface SearchLocation {
  id: string;
  name: string;
  path: string;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: SearchFilters;
  scope: SearchScopeId;
  customRoots: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SearchHistoryEntry {
  id: string;
  query: string;
  scope: SearchScopeId;
  /** Optional snapshot of the interpreted/filter state for one-click reuse. */
  filters?: SearchFilters;
  at: number;
}

export interface SearchSettings {
  defaultScope: SearchScopeId;
  defaultView: SearchView;
  customRoots: string[];
  historyEnabled: boolean;
  retentionDays: number;
  maxHistory: number;
  includeLive: boolean;
  includeSpotlight: boolean;
  semanticSearch: boolean;
  visualSearch: boolean;
  largeFileBytes: number;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  kinds: [],
  extensions: [],
  minSize: null,
  maxSize: null,
  modified: null,
  created: null,
  accessed: null,
  contentMode: "both",
  matchMode: "all",
  caseSensitive: false,
  includeHidden: false,
  noExtension: false,
  emptyFolders: false,
  duplicatesOnly: false,
  locations: [],
};

export const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  defaultScope: "indexed",
  defaultView: "list",
  customRoots: [],
  historyEnabled: true,
  retentionDays: 90,
  maxHistory: 40,
  includeLive: true,
  includeSpotlight: true,
  semanticSearch: false,
  visualSearch: false,
  largeFileBytes: 100 * 1024 * 1024,
};

export const KIND_LABELS: Record<SearchKind, string> = {
  folder: "Folders",
  document: "Documents",
  pdf: "PDFs",
  image: "Images",
  video: "Videos",
  audio: "Audio",
  archive: "Archives",
  code: "Source code",
  app: "Applications",
  sheet: "Spreadsheets",
  slides: "Presentations",
  text: "Text",
  font: "Fonts",
  executable: "Executables",
  file: "Other files",
};
