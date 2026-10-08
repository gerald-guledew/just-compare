import { useCallback, useRef, useState } from "react";
import { useAppStore, type Side } from "../stores/appStore";
import type { OperationSpec } from "./useFolderOps";
import { eventHasShift, getShiftHeld } from "./useShiftHeld";
import { eventDebugInfo, logDnd } from "../lib/dndDebug";

// Dragging rows from one folder pane to the other, tracked with plain mouse
// events. Native HTML5 drag-and-drop is not an option: the window uses Tauri's
// native drop handler (needed to get real paths for files dropped from the
// OS), and with that handler on, the webview never delivers dragover/drop to
// the page.

/** Pixels the pointer must travel before a press on a row becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

const BODY_DRAGGING = "select-none";
const BODY_COPY = "jc-pointer-copy-dragging";
const BODY_MOVE = "jc-pointer-move-dragging";

interface RowDrag {
  sourceSide: Side;
  relativePath: string;
  /** Shift was down when the row was pressed: the drag is a move throughout. */
  startedAsMove: boolean;
  startX: number;
  startY: number;
  /** What is being dragged; null until the pointer passes the threshold. */
  paths: string[] | null;
}

function paneSideFromPoint(x: number, y: number): Side | null {
  const el = document.elementFromPoint(x, y);
  const pane = el?.closest("[data-comparison-pane-side]") as HTMLElement | null;
  const side = pane?.dataset.comparisonPaneSide;
  return side === "left" || side === "right" ? side : null;
}

/** The click that follows a drag's mouseup must not select or expand a row. */
function swallowNextClick(): void {
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  // No click follows when press and release land on unrelated elements.
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}

export interface RowPointerDrag {
  /** mousedown handler for the rows of one pane. */
  onRowMouseDownFor: (
    side: Side,
  ) => (relativePath: string, e: React.MouseEvent) => void;
  /** The pane the dragged rows would land in if released now. */
  dropTargetSide: Side | null;
}

export function useRowPointerDrag(
  onRunOperation: (spec: OperationSpec) => Promise<void>,
): RowPointerDrag {
  const dragRef = useRef<RowDrag | null>(null);
  const [dropTargetSide, setDropTargetSide] = useState<Side | null>(null);

  const onRowMouseDownFor = useCallback(
    (side: Side) => (relativePath: string, e: React.MouseEvent) => {
      if (e.button !== 0 || !relativePath) return;

      const startedAsMove = getShiftHeld() || eventHasShift(e);
      // Shift+press would otherwise make WebKit extend a text selection.
      if (startedAsMove) e.preventDefault();

      dragRef.current = {
        sourceSide: side,
        relativePath,
        startedAsMove,
        startX: e.clientX,
        startY: e.clientY,
        paths: null,
      };
      logDnd("row press", { side, relativePath, event: eventDebugInfo(e) });

      const isMove = (drag: RowDrag) => drag.startedAsMove || getShiftHeld();

      const finish = (): RowDrag | null => {
        const drag = dragRef.current;
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove, true);
        window.removeEventListener("mouseup", onUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
        document.body.classList.remove(BODY_DRAGGING, BODY_COPY, BODY_MOVE);
        setDropTargetSide(null);
        return drag;
      };

      const onMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        // The button was released where we could not see it.
        if ((ev.buttons & 1) === 0) {
          finish();
          return;
        }

        if (!drag.paths) {
          const travelled = Math.hypot(
            ev.clientX - drag.startX,
            ev.clientY - drag.startY,
          );
          if (travelled < DRAG_THRESHOLD_PX) return;
          // Dragging a selected row takes the whole selection along; dragging
          // any other row drags (and selects) just that row.
          const { selectedPaths, setSelection } = useAppStore.getState();
          if (selectedPaths.has(drag.relativePath)) {
            drag.paths = Array.from(selectedPaths);
          } else {
            drag.paths = [drag.relativePath];
            setSelection(drag.paths);
          }
          document.body.classList.add(BODY_DRAGGING);
          logDnd("row drag start", {
            sourceSide: drag.sourceSide,
            paths: drag.paths,
          });
        }

        const move = isMove(drag);
        document.body.classList.toggle(BODY_MOVE, move);
        document.body.classList.toggle(BODY_COPY, !move);
        const over = paneSideFromPoint(ev.clientX, ev.clientY);
        setDropTargetSide(over && over !== drag.sourceSide ? over : null);
      };

      const onUp = (ev: MouseEvent) => {
        const drag = finish();
        if (!drag?.paths) return; // a plain click, not a drag
        swallowNextClick();

        const targetSide = paneSideFromPoint(ev.clientX, ev.clientY);
        const kind = isMove(drag) ? "move" : "copy";
        logDnd("row drag end", {
          sourceSide: drag.sourceSide,
          targetSide,
          kind,
          paths: drag.paths,
        });
        if (!targetSide || targetSide === drag.sourceSide) return;

        // Operate on exactly what was dragged.
        useAppStore.getState().setSelection(drag.paths);
        void onRunOperation({
          kind,
          sourceSide: drag.sourceSide,
          targetSide,
        });
      };

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        const drag = finish();
        if (drag?.paths) swallowNextClick();
      };

      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
      window.addEventListener("keydown", onKeyDown, true);
    },
    [onRunOperation],
  );

  return { onRowMouseDownFor, dropTargetSide };
}
