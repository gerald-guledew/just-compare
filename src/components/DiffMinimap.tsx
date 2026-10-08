import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DiffLine, DiffLineKind } from "../types";

interface DiffMinimapProps {
  lines: DiffLine[];
  totalContentHeight: number;
  scrollTop: number;
  viewportHeight: number;
  onJumpToOffset: (scrollTop: number) => void;
}

interface Run {
  start: number;
  end: number;
  kind: DiffLineKind;
}

function tickColorClass(_kind: DiffLineKind): string {
  return "bg-red-400";
}

export function DiffMinimap({
  lines,
  totalContentHeight,
  scrollTop,
  viewportHeight,
  onJumpToOffset,
}: DiffMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const runs = useMemo<Run[]>(() => {
    const out: Run[] = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind === "Equal") {
        i++;
        continue;
      }
      const kind = lines[i].kind;
      const start = i;
      while (
        i < lines.length &&
        lines[i].kind !== "Equal" &&
        lines[i].kind === kind
      ) {
        i++;
      }
      out.push({ start, end: i, kind });
    }
    return out;
  }, [lines]);

  const jumpFromClientY = useCallback(
    (clientY: number) => {
      const el = containerRef.current;
      if (!el || totalContentHeight <= 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const frac = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      // Center the viewport on the clicked position so the target row lands mid-pane,
      // not at the top edge where it's hard to see.
      const target = frac * totalContentHeight - viewportHeight / 2;
      onJumpToOffset(target);
    },
    [onJumpToOffset, totalContentHeight, viewportHeight],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      draggingRef.current = true;
      jumpFromClientY(e.clientY);
    },
    [jumpFromClientY],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      jumpFromClientY(e.clientY);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [jumpFromClientY]);

  const totalLines = lines.length;
  const viewportTopPct =
    totalContentHeight > 0 ? (scrollTop / totalContentHeight) * 100 : 0;
  const viewportHeightPct =
    totalContentHeight > 0
      ? Math.min(100, (viewportHeight / totalContentHeight) * 100)
      : 100;

  return (
    <div
      ref={containerRef}
      onMouseDown={onMouseDown}
      className="relative w-4 shrink-0 bg-gray-50 border border-gray-200 rounded-lg overflow-hidden cursor-pointer select-none"
      aria-label="Diff minimap"
    >
      {runs.map((run) => {
        const topPct = totalLines > 0 ? (run.start / totalLines) * 100 : 0;
        const heightPct =
          totalLines > 0
            ? Math.max(0.5, ((run.end - run.start) / totalLines) * 100)
            : 0;
        return (
          <div
            key={run.start}
            className={`absolute left-0 right-0 ${tickColorClass(run.kind)}`}
            style={{
              top: `${topPct}%`,
              height: `${heightPct}%`,
            }}
          />
        );
      })}
      <div
        className="absolute left-0 right-0 bg-blue-300/30 border-y border-blue-500 pointer-events-none"
        style={{
          top: `${viewportTopPct}%`,
          height: `${viewportHeightPct}%`,
        }}
      />
    </div>
  );
}
