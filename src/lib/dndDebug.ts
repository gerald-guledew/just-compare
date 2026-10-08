type DebugWindow = Window & {
  __JC_DND_DEBUG?: boolean;
  __JC_DND_LOGS?: Array<{ at: string; label: string; details?: unknown }>;
};

interface ModifierEventLike {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  clientX?: number;
  clientY?: number;
  type: string;
  getModifierState?: (key: "Shift") => boolean;
}

function isEnabled(): boolean {
  if (typeof window === "undefined") return import.meta.env.DEV;
  const override = window.localStorage.getItem("jc:dnd-debug");
  if (override === "0") return false;
  if (override === "1") return true;
  return import.meta.env.DEV || (window as DebugWindow).__JC_DND_DEBUG === true;
}

export function logDnd(label: string, details?: unknown): void {
  if (!isEnabled()) return;
  if (typeof window !== "undefined") {
    const w = window as DebugWindow;
    w.__JC_DND_LOGS ??= [];
    w.__JC_DND_LOGS.push({ at: new Date().toISOString(), label, details });
  }
  console.debug(`[JustCompare DnD] ${label}`, details ?? "");
}

export function eventDebugInfo(e: ModifierEventLike) {
  return {
    type: e.type,
    shiftKey: e.shiftKey,
    modifierShift: e.getModifierState?.("Shift") === true,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    clientX: e.clientX,
    clientY: e.clientY,
  };
}
