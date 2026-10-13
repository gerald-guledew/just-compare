import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../stores/appStore";

interface ScrollContext {
  tabId: string;
  leftPath: string | null;
  rightPath: string | null;
}

interface CachedScroll extends ScrollContext {
  scrollTop: number;
}

// One offset per live folder tab, invalidated when either root changes.
const folderScrollOffsets = new Map<string, CachedScroll>();

function liveContext(context: ScrollContext): boolean {
  const state = useAppStore.getState();
  const tab = state.tabs.find((item) => item.id === context.tabId);
  if (tab?.kind !== "folder-compare") return false;
  const folder =
    context.tabId === state.activeTabId
      ? state
      : state.folderTabs[context.tabId];
  return (
    !!folder &&
    folder.leftPath === context.leftPath &&
    folder.rightPath === context.rightPath
  );
}

const stopPruning = useAppStore.subscribe(() => {
  for (const [tabId, context] of folderScrollOffsets) {
    if (!liveContext(context)) folderScrollOffsets.delete(tabId);
  }
});
if (import.meta.hot) import.meta.hot.dispose(stopPruning);

function cachedOffset(context: ScrollContext | undefined): number {
  if (!context) return 0;
  const cached = folderScrollOffsets.get(context.tabId);
  return cached &&
    cached.leftPath === context.leftPath &&
    cached.rightPath === context.rightPath
    ? cached.scrollTop
    : 0;
}

interface UseDiffScrollOptions {
  count: number;
  rowHeight: number;
  overscan?: number;
  scrollContext?: ScrollContext;
}

interface ScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
}

export function useDiffScroll({
  count,
  rowHeight,
  overscan = 10,
  scrollContext,
}: UseDiffScrollOptions) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const scrollingRef = useRef(false);
  const initialOffset = cachedOffset(scrollContext);

  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>({
    scrollTop: initialOffset,
    viewportHeight: 0,
  });

  const leftVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => leftRef.current,
    estimateSize: () => rowHeight,
    overscan,
    initialOffset,
  });

  const rightVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => rightRef.current,
    estimateSize: () => rowHeight,
    overscan,
    initialOffset,
  });

  const rememberOffset = useCallback(
    (scrollTop: number) => {
      if (scrollContext && liveContext(scrollContext)) {
        folderScrollOffsets.set(scrollContext.tabId, {
          ...scrollContext,
          scrollTop,
        });
      }
    },
    [scrollContext],
  );

  const syncMetrics = useCallback(() => {
    const el = leftRef.current;
    if (!el) return;
    rememberOffset(el.scrollTop);
    setScrollMetrics((prev) =>
      prev.scrollTop === el.scrollTop && prev.viewportHeight === el.clientHeight
        ? prev
        : { scrollTop: el.scrollTop, viewportHeight: el.clientHeight },
    );
  }, [rememberOffset]);

  useLayoutEffect(() => {
    const left = leftRef.current;
    const right = rightRef.current;
    const offset = cachedOffset(scrollContext);
    if (left) left.scrollTop = offset;
    if (right) right.scrollTop = offset;
    syncMetrics();
    return () => {
      // The store may already have closed this tab or changed its roots.
      rememberOffset(left?.scrollTop ?? right?.scrollTop ?? offset);
    };
  }, [scrollContext, rememberOffset, syncMetrics]);

  const onLeftScroll = useCallback(() => {
    if (scrollingRef.current) return;
    scrollingRef.current = true;
    if (leftRef.current && rightRef.current) {
      rightRef.current.scrollTop = leftRef.current.scrollTop;
    }
    scrollingRef.current = false;
    syncMetrics();
  }, [syncMetrics]);

  const onRightScroll = useCallback(() => {
    if (scrollingRef.current) return;
    scrollingRef.current = true;
    if (leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    }
    scrollingRef.current = false;
    syncMetrics();
  }, [syncMetrics]);

  const scrollToOffset = useCallback(
    (scrollTop: number) => {
      const el = leftRef.current;
      const other = rightRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const clamped = Math.max(0, Math.min(max, scrollTop));
      scrollingRef.current = true;
      el.scrollTop = clamped;
      if (other) other.scrollTop = clamped;
      scrollingRef.current = false;
      syncMetrics();
    },
    [syncMetrics],
  );

  useEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    syncMetrics();
    const ro = new ResizeObserver(() => syncMetrics());
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncMetrics]);

  return {
    leftRef,
    rightRef,
    leftVirtualizer,
    rightVirtualizer,
    onLeftScroll,
    onRightScroll,
    scrollMetrics,
    scrollToOffset,
  };
}
