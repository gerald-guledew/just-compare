import { useEffect, useId, useRef, useState } from "react";
import type { Side } from "../stores/appStore";

export type ComparisonItemKind = "file" | "folder" | "unknown";
export type SelectedComparisonKind = Exclude<ComparisonItemKind, "unknown">;

interface PathPickerButtonProps {
  side: Side;
  itemKind: ComparisonItemKind;
  onPick: (kind: SelectedComparisonKind) => void;
  disabled?: boolean;
  variant?: "icon" | "select";
}

/** A native picker needs a file or folder choice before opening its dialog. */
export function PathPickerButton({
  side,
  itemKind,
  onPick,
  disabled = false,
  variant = "icon",
}: PathPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const itemLabel = itemKind === "unknown" ? "folder/file" : itemKind;
  const label = `${variant === "select" ? "Select" : "Choose"} ${side} ${itemLabel}`;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const pick = (kind: SelectedComparisonKind) => {
    setOpen(false);
    buttonRef.current?.focus();
    onPick(kind);
  };

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (itemKind === "unknown") setOpen((value) => !value);
          else pick(itemKind);
        }}
        onKeyDown={(event) => {
          if (itemKind === "unknown" && event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        aria-label={label}
        aria-haspopup={itemKind === "unknown" ? "menu" : undefined}
        aria-expanded={itemKind === "unknown" ? open : undefined}
        aria-controls={open ? menuId : undefined}
        title={label}
        className={
          variant === "select"
            ? "px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed"
            : "flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        }
      >
        {variant === "select" ? (
          label
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {/* Feather v4.29.2 folder icon, MIT. See docs/ASSET_PROVENANCE.md. */}
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Choose ${side} comparison item`}
          className={`absolute z-50 mt-1 min-w-40 p-1 rounded-md border border-gray-200 bg-white shadow-lg ${variant === "icon" ? "right-0" : "left-1/2 -translate-x-1/2"}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button",
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const offset = event.key === "ArrowDown" ? 1 : -1;
              buttons[
                (index + offset + buttons.length) % buttons.length
              ]?.focus();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("file")}
            className="w-full px-3 py-1.5 rounded text-left text-xs text-gray-700 hover:bg-gray-100 focus:bg-blue-50 focus:outline-none"
          >
            Choose a file…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("folder")}
            className="w-full px-3 py-1.5 rounded text-left text-xs text-gray-700 hover:bg-gray-100 focus:bg-blue-50 focus:outline-none"
          >
            Choose a folder…
          </button>
        </div>
      )}
    </div>
  );
}
