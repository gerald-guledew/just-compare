import type { Side } from "../stores/appStore";

interface DropTargetOverlayProps {
  side: Side;
  /** Inset and column classes that line the overlay's first and last column
   *  up with the left and right pane underneath. */
  layout: string;
}

/** Outlines the pane that a file or folder dragged in from the OS would
 *  replace. Render inside a `relative` container. */
export function DropTargetOverlay({ side, layout }: DropTargetOverlayProps) {
  const ring = "rounded-lg bg-blue-400/10 ring-2 ring-inset ring-blue-400";
  return (
    <div className={`absolute z-50 grid pointer-events-none ${layout}`}>
      <div className={`row-start-1 col-start-1 ${side === "left" ? ring : ""}`} />
      <div className={`row-start-1 -col-end-1 ${side === "right" ? ring : ""}`} />
    </div>
  );
}
