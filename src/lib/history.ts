export interface HistoryState {
  history: string[];
  index: number;
}

export function createHistory(location: string): HistoryState {
  return { history: [location], index: 0 };
}

export function pushHistory(
  history: string[],
  index: number,
  location: string,
  limit = 100,
): HistoryState {
  if (history[index] === location) return { history, index };
  const next = history.slice(0, index + 1);
  next.push(location);
  const overflow = Math.max(0, next.length - limit);
  return {
    history: overflow ? next.slice(overflow) : next,
    index: (overflow ? index - overflow : index) + 1,
  };
}

export function backHistory(history: string[], index: number): HistoryState | null {
  if (index <= 0) return null;
  return { history, index: index - 1 };
}

export function forwardHistory(history: string[], index: number): HistoryState | null {
  if (index >= history.length - 1) return null;
  return { history, index: index + 1 };
}

export function canGoBack(history: string[], index: number): boolean {
  return index > 0;
}

export function canGoForward(history: string[], index: number): boolean {
  return index < history.length - 1;
}
