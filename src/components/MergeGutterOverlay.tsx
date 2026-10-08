import { useEffect, useState } from "react";
import type * as monaco from "monaco-editor";
import type { DiffBlock } from "../lib/diffBlocks";

interface MergeGutterOverlayProps {
  blocks: DiffBlock[];
  leftEditor: monaco.editor.IStandaloneCodeEditor | null;
  rightEditor: monaco.editor.IStandaloneCodeEditor | null;
  canMerge: boolean;
  onMerge: (direction: "leftToRight" | "rightToLeft", block: DiffBlock) => void;
}

interface BlockPosition {
  block: DiffBlock;
  topPx: number;
  visible: boolean;
}

function computeBlockTop(
  block: DiffBlock,
  leftEditor: monaco.editor.IStandaloneCodeEditor | null,
  rightEditor: monaco.editor.IStandaloneCodeEditor | null,
): number | null {
  const leftHasContent = block.leftText.length > 0;
  const rightHasContent = block.rightText.length > 0;
  if (leftHasContent && leftEditor) {
    return (
      leftEditor.getTopForLineNumber(block.leftTargetStart) -
      leftEditor.getScrollTop()
    );
  }
  if (rightHasContent && rightEditor) {
    return (
      rightEditor.getTopForLineNumber(block.rightTargetStart) -
      rightEditor.getScrollTop()
    );
  }
  return null;
}

export function MergeGutterOverlay({
  blocks,
  leftEditor,
  rightEditor,
  canMerge,
  onMerge,
}: MergeGutterOverlayProps) {
  // Re-render on every scroll/layout tick from either editor. Using a tick
  // counter keeps state changes minimal — actual positions are recomputed in
  // render from the editor APIs.
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => (t + 1) & 0xfffff);

  useEffect(() => {
    if (!leftEditor && !rightEditor) return;
    const subs: monaco.IDisposable[] = [];
    if (leftEditor) {
      subs.push(leftEditor.onDidScrollChange(bump));
      subs.push(leftEditor.onDidContentSizeChange(bump));
      subs.push(leftEditor.onDidLayoutChange(bump));
    }
    if (rightEditor) {
      subs.push(rightEditor.onDidScrollChange(bump));
      subs.push(rightEditor.onDidContentSizeChange(bump));
      subs.push(rightEditor.onDidLayoutChange(bump));
    }
    return () => subs.forEach((s) => s.dispose());
  }, [leftEditor, rightEditor]);

  if (!canMerge || blocks.length === 0) return null;

  const viewportHeight =
    leftEditor?.getLayoutInfo().height ??
    rightEditor?.getLayoutInfo().height ??
    0;

  const positions: BlockPosition[] = blocks.map((block) => {
    const topPx = computeBlockTop(block, leftEditor, rightEditor);
    if (topPx === null) {
      return { block, topPx: 0, visible: false };
    }
    return {
      block,
      topPx,
      visible: topPx >= -20 && topPx <= viewportHeight,
    };
  });

  // Layout matches FileCompareView's `1fr_36px_1fr` grid so the middle cell
  // lines up exactly with the dedicated merge gutter between the two editors.
  return (
    <div className="absolute inset-0 grid grid-cols-[1fr_36px_1fr] pointer-events-none">
      <div />
      <div className="relative">
        {positions.map(
          (p) =>
            p.visible && (
              <BlockArrows
                key={p.block.startIndex}
                topPx={p.topPx}
                onLeftToRight={() => onMerge("leftToRight", p.block)}
                onRightToLeft={() => onMerge("rightToLeft", p.block)}
              />
            ),
        )}
      </div>
      <div />
    </div>
  );
}

function BlockArrows({
  topPx,
  onLeftToRight,
  onRightToLeft,
}: {
  topPx: number;
  onLeftToRight: () => void;
  onRightToLeft: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 flex items-center justify-center gap-0.5 pointer-events-none"
      style={{ top: `${topPx}px`, height: "20px" }}
    >
      <ArrowButton direction="leftToRight" onClick={onLeftToRight} />
      <ArrowButton direction="rightToLeft" onClick={onRightToLeft} />
    </div>
  );
}

function ArrowButton({
  direction,
  onClick,
}: {
  direction: "leftToRight" | "rightToLeft";
  onClick: () => void;
}) {
  const label =
    direction === "leftToRight"
      ? "Copy block to right"
      : "Copy block to left";
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-5 w-4 flex items-center justify-center rounded text-amber-600 hover:text-amber-700 hover:bg-amber-200 cursor-pointer pointer-events-auto"
      aria-label={label}
      title={label}
    >
      {/* Original directional glyphs. See docs/ASSET_PROVENANCE.md. */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        {direction === "leftToRight" ? (
          <path d="M3 10h10V5l8 7-8 7v-5H3Z" />
        ) : (
          <path d="M21 10H11V5l-8 7 8 7v-5h10Z" />
        )}
      </svg>
    </button>
  );
}
