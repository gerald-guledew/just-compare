import { useCallback, useRef } from "react";

interface ColumnResizeHandleProps {
  onResize: (delta: number) => void;
}

export function ColumnResizeHandle({ onResize }: ColumnResizeHandleProps) {
  const startXRef = useRef(0);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startXRef.current;
        startXRef.current = moveEvent.clientX;
        onResizeRef.current(delta);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [],
  );

  return (
    <div
      className="w-1 shrink-0 cursor-col-resize bg-gray-300 hover:bg-blue-400 active:bg-blue-500 self-stretch"
      onMouseDown={onMouseDown}
    />
  );
}
