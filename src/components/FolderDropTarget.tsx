import type { RefObject } from "react";
import { useOsFileDrop } from "../hooks/useOsFileDrop";
import type { Side } from "../stores/appStore";
import { DropTargetOverlay } from "./DropTargetOverlay";

interface FolderDropTargetProps {
  /** The area whose left and right halves accept a drop. */
  areaRef: RefObject<HTMLElement | null>;
  onDropFolder: (side: Side, path: string) => void;
}

/** Lets a folder dragged in from Finder/Explorer be dropped on the left or
 *  right half of the folder comparison. Mount only while that tab is showing. */
export function FolderDropTarget({
  areaRef,
  onDropFolder,
}: FolderDropTargetProps) {
  const side = useOsFileDrop(areaRef, onDropFolder);
  if (!side) return null;
  // Matches the two panes inside the padded content area.
  return <DropTargetOverlay side={side} layout="inset-2 grid-cols-2 gap-2" />;
}
