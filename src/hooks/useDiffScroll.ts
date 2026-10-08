import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface UseDiffScrollOptions {
  count: number;
  rowHeight: number;
  overscan?: number;
}

interface ScrollMetrics {
  scrollTop: number;
  viewportHeight: number;
}

export function useDiffScroll({
  count,
  rowHeight,
  overscan = 10,
}: UseDiffScrollOptions) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const scrollingRef = useRef(false);

  const [scrollMetrics, setScrollMetrics] = useState<ScrollMetrics>({
    scrollTop: 0,
    viewportHeight: 0,
  });

  const leftVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => leftRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const rightVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => rightRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const syncMetrics = useCallback(() => {
    const el = leftRef.current;
    if (!el) return;
    setScrollMetrics((prev) =>
      prev.scrollTop === el.scrollTop && prev.viewportHeight === el.clientHeight
        ? prev
        : { scrollTop: el.scrollTop, viewportHeight: el.clientHeight },
    );
  }, []);

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
