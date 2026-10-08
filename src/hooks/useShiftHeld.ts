import { useEffect, useState } from "react";
import { eventDebugInfo, logDnd } from "../lib/dndDebug";

// Shared shift-key tracking. We track it ourselves rather than relying on
// `e.shiftKey` at dragstart because that field has timing quirks across
// platforms — particularly on macOS WebKit where the modifier state at the
// dragstart event is not always synchronized with the user's actual key
// state when shift was pressed *after* mousedown.

let _held = false;
const _listeners = new Set<(v: boolean) => void>();

function set(
  next: boolean,
  reason: string,
  event?: KeyboardEvent | MouseEvent | PointerEvent,
) {
  if (_held === next) return;
  _held = next;
  logDnd("shift state changed", {
    held: next,
    reason,
    event: event ? eventDebugInfo(event) : undefined,
  });
  _listeners.forEach((l) => l(next));
}

export function eventHasShift(e: {
  shiftKey: boolean;
  getModifierState?: (key: "Shift") => boolean;
}): boolean {
  return e.shiftKey || e.getModifierState?.("Shift") === true;
}

function syncFromModifierEvent(e: MouseEvent | PointerEvent): void {
  set(eventHasShift(e), e.type, e);
}

if (typeof window !== "undefined") {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Shift") set(true, "keydown", e);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Shift") set(false, "keyup", e);
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp, { capture: true });
  window.addEventListener("mousedown", syncFromModifierEvent, {
    capture: true,
  });
  window.addEventListener("mouseup", syncFromModifierEvent, {
    capture: true,
  });
  window.addEventListener("mousemove", syncFromModifierEvent, {
    capture: true,
  });
  window.addEventListener("pointermove", syncFromModifierEvent, {
    capture: true,
  });
  // No `blur` listener on purpose: WebKit fires window blur as a drag
  // begins (the OS takes over input focus), which would erroneously clear
  // _held mid-drag and break the shift+drag-to-move flow. The trade-off is
  // that if the user switches apps while holding shift, we won't see the
  // keyup — but their next shift press resyncs us.
}

/** Synchronous read — use inside event handlers (e.g. dragstart). */
export function getShiftHeld(): boolean {
  return _held;
}

/** Reactive subscription — components re-render on shift state changes. */
export function useShiftHeld(): boolean {
  const [held, setHeld] = useState(_held);
  useEffect(() => {
    _listeners.add(setHeld);
    setHeld(_held);
    return () => {
      _listeners.delete(setHeld);
    };
  }, []);
  return held;
}
