import { useEffect, useRef, useState, type RefObject } from "react";
import type { Side } from "../stores/appStore";
import { onOsFileDrag } from "../lib/tauri";

/** Lets a file dragged in from the OS be dropped on the left or right half of
 *  `areaRef`. Returns the half currently hovered, for highlighting. */
export function useOsFileDrop(
  areaRef: RefObject<HTMLElement | null>,
  onDropFile: (side: Side, path: string) => void,
): Side | null {
  const [hoverSide, setHoverSide] = useState<Side | null>(null);
  const onDropFileRef = useRef(onDropFile);
  useEffect(() => {
    onDropFileRef.current = onDropFile;
  }, [onDropFile]);

  useEffect(() => {
    const sideAt = (x: number): Side | null => {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return x < rect.left + rect.width / 2 ? "left" : "right";
    };

    let disposed = false;
    let unlisten: (() => void) | null = null;
    onOsFileDrag((event) => {
      if (event.type === "over") {
        setHoverSide(sideAt(event.x));
        return;
      }
      setHoverSide(null);
      if (event.type !== "drop") return;
      const side = sideAt(event.x);
      if (side) onDropFileRef.current(side, event.paths[0]);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e: unknown) => console.error("file drop unavailable:", e));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [areaRef]);

  return hoverSide;
}
