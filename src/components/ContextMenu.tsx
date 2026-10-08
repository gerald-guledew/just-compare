import { useEffect, useRef } from "react";
import type { Side } from "../stores/appStore";

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  divider?: false;
  onClick: () => void;
}

export interface DividerItem {
  divider: true;
}

export type ContextMenuEntry = ContextMenuItem | DividerItem;

interface ContextMenuState {
  x: number;
  y: number;
  side: Side;
  rowPath: string | null;
  items: ContextMenuEntry[];
}

interface ContextMenuProps {
  state: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      style={{ left: state.x, top: state.y }}
      className="fixed z-50 min-w-[200px] py-1 bg-white border border-gray-300 rounded shadow-lg text-sm"
    >
      {state.items.map((item, i) =>
        "divider" in item ? (
          <div key={`div-${i}`} className="my-1 border-t border-gray-200" />
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            className="w-full text-left px-3 py-1 flex justify-between gap-4 hover:bg-blue-100 disabled:text-gray-400 disabled:cursor-not-allowed cursor-pointer"
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-gray-400">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}

export type { ContextMenuState };
