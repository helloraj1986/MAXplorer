import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface VirtualRowBase {
  key: string;
  height: number;
}

export interface VisibleRow<T> {
  row: T;
  index: number;
  top: number;
}

export function useVirtualRows<T extends VirtualRowBase>(
  rows: T[],
  overscan = 6,
): {
  containerRef: React.RefObject<HTMLDivElement>;
  visibleRows: VisibleRow<T>[];
  totalHeight: number;
  viewportHeight: number;
  scrollTop: number;
  onScroll: () => void;
  scrollToIndex: (index: number) => void;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const offsets = useMemo(() => {
    const result = new Array<number>(rows.length + 1);
    result[0] = 0;
    for (let index = 0; index < rows.length; index += 1) {
      result[index + 1] = result[index] + rows[index].height;
    }
    return result;
  }, [rows]);

  const totalHeight = offsets[rows.length] ?? 0;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const element = containerRef.current;
    if (element) setScrollTop(element.scrollTop);
  }, []);

  const visibleRows = useMemo(() => {
    if (!rows.length) return [];
    let low = 0;
    let high = rows.length - 1;
    let start = rows.length;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (offsets[middle + 1] > scrollTop) {
        start = middle;
        high = middle - 1;
      } else {
        low = middle + 1;
      }
    }
    if (start === rows.length) start = rows.length - 1;
    start = Math.max(0, start - overscan);
    let end = start;
    const limit = scrollTop + viewportHeight + overscan * 32;
    while (end < rows.length && offsets[end] < limit) end += 1;
    const result: VisibleRow<T>[] = [];
    for (let index = start; index < end; index += 1) {
      result.push({ row: rows[index], index, top: offsets[index] });
    }
    return result;
  }, [offsets, overscan, rows, scrollTop, viewportHeight]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = containerRef.current;
      if (!element || !rows.length) return;
      const clamped = Math.max(0, Math.min(index, rows.length - 1));
      const top = offsets[clamped];
      const height = rows[clamped].height;
      if (top < element.scrollTop) {
        element.scrollTop = top;
      } else if (top + height > element.scrollTop + element.clientHeight) {
        element.scrollTop = top + height - element.clientHeight;
      }
    },
    [offsets, rows],
  );

  return {
    containerRef,
    visibleRows,
    totalHeight,
    viewportHeight,
    scrollTop,
    onScroll,
    scrollToIndex,
  };
}
