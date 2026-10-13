import "../lib/monaco/setup";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type * as monaco from "monaco-editor";
import { useBufferDiff } from "../hooks/useBufferDiff";
import { useFileBuffers } from "../hooks/useFileBuffers";
import { useDiffAlignment } from "../hooks/useDiffAlignment";
import { useOsFileDrop } from "../hooks/useOsFileDrop";
import { MonacoDiffPane, applyMonacoEdit } from "./MonacoDiffPane";
import { MergeGutterOverlay } from "./MergeGutterOverlay";
import { PaneHeader } from "./PaneHeader";
import { DiffMinimap } from "./DiffMinimap";
import { DropTargetOverlay } from "./DropTargetOverlay";
import { openFileDialog } from "../lib/tauri";
import { computeDiffBlocks, type DiffBlock } from "../lib/diffBlocks";
import { useAppStore, type BufferEdit, type Side } from "../stores/appStore";

interface FileCompareViewProps {
  leftFilePath: string;
  rightFilePath: string;
  tabId: string;
  onPathCommit?: (side: Side, path: string) => Promise<boolean>;
  onPickFile?: (side: Side) => void;
  pathsDisabled?: boolean;
}

export function FileCompareView({
  leftFilePath,
  rightFilePath,
  tabId,
  onPathCommit,
  onPickFile,
  pathsDisabled = false,
}: FileCompareViewProps) {
  const { save, reload } = useFileBuffers(tabId, leftFilePath, rightFilePath);

  const tab = useAppStore((s) => s.fileTabs[tabId]);
  const applyBufferMerge = useAppStore((s) => s.applyBufferMerge);
  const setFileTabBufferText = useAppStore((s) => s.setFileTabBufferText);
  const setTabFilePath = useAppStore((s) => s.setTabFilePath);
  const wordWrap = useAppStore((s) => s.wordWrap);

  const leftBuf = tab?.left ?? null;
  const rightBuf = tab?.right ?? null;
  const leftError = tab?.leftError ?? null;
  const rightError = tab?.rightError ?? null;

  const leftDiffText = leftBuf?.text ?? (leftError ? "" : null);
  const rightDiffText = rightBuf?.text ?? (rightError ? "" : null);
  const { result, loading, error } = useBufferDiff(
    leftDiffText,
    rightDiffText,
    tabId,
  );

  const lines = useMemo(() => result?.lines ?? [], [result]);
  const blocks = useMemo(() => computeDiffBlocks(lines), [lines]);

  const leftEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const rightEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const monacoRef = useRef<typeof monaco | null>(null);
  const syncingRef = useRef(false);
  // Set during a merge-button-driven applyMonacoEdit so the resulting
  // onDidChangeModelContent → onModelEdit callback skips writing the text
  // back to the store. The merge handler itself calls applyBufferMerge, which
  // owns the store update (text + new yellow range).
  const mergingRef = useRef(false);

  const [leftEditor, setLeftEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [rightEditor, setRightEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  useDiffAlignment(leftEditor, rightEditor, lines, wordWrap);

  const [scrollMetrics, setScrollMetrics] = useState({
    scrollTop: 0,
    viewportHeight: 0,
    contentHeight: 0,
  });

  const refreshMetrics = useCallback(() => {
    const ed = leftEditorRef.current;
    if (!ed) return;
    const layout = ed.getLayoutInfo();
    setScrollMetrics((prev) => {
      const next = {
        scrollTop: ed.getScrollTop(),
        viewportHeight: layout.height,
        contentHeight: ed.getContentHeight(),
      };
      return prev.scrollTop === next.scrollTop &&
        prev.viewportHeight === next.viewportHeight &&
        prev.contentHeight === next.contentHeight
        ? prev
        : next;
    });
  }, []);

  const handleLeftReady = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoApi: typeof monaco) => {
      leftEditorRef.current = editor;
      monacoRef.current = monacoApi;
      setLeftEditor(editor);
      refreshMetrics();
    },
    [refreshMetrics],
  );
  const handleLeftDispose = useCallback(() => {
    leftEditorRef.current = null;
    setLeftEditor(null);
  }, []);
  const handleRightReady = useCallback(
    (editor: monaco.editor.IStandaloneCodeEditor, monacoApi: typeof monaco) => {
      rightEditorRef.current = editor;
      monacoRef.current = monacoApi;
      setRightEditor(editor);
    },
    [],
  );
  const handleRightDispose = useCallback(() => {
    rightEditorRef.current = null;
    setRightEditor(null);
  }, []);

  const onLeftScroll = useCallback(
    (e: monaco.IScrollEvent) => {
      refreshMetrics();
      const right = rightEditorRef.current;
      if (!right || syncingRef.current) return;
      syncingRef.current = true;
      try {
        right.setScrollTop(e.scrollTop);
        right.setScrollLeft(e.scrollLeft);
      } finally {
        syncingRef.current = false;
      }
    },
    [refreshMetrics],
  );

  const onRightScroll = useCallback((e: monaco.IScrollEvent) => {
    const left = leftEditorRef.current;
    if (!left || syncingRef.current) return;
    syncingRef.current = true;
    try {
      left.setScrollTop(e.scrollTop);
      left.setScrollLeft(e.scrollLeft);
    } finally {
      syncingRef.current = false;
    }
  }, []);

  const onLeftContentSizeChange = useCallback(() => {
    refreshMetrics();
  }, [refreshMetrics]);
  const onRightContentSizeChange = useCallback(() => {}, []);

  const onLeftModelEdit = useCallback(
    (newText: string, edit: BufferEdit | null) => {
      if (mergingRef.current) return;
      setFileTabBufferText(tabId, "left", newText, edit);
    },
    [tabId, setFileTabBufferText],
  );
  const onRightModelEdit = useCallback(
    (newText: string, edit: BufferEdit | null) => {
      if (mergingRef.current) return;
      setFileTabBufferText(tabId, "right", newText, edit);
    },
    [tabId, setFileTabBufferText],
  );

  const onRequestSave = useCallback(() => {
    void save("all");
  }, [save]);

  const merge = useCallback(
    (direction: "leftToRight" | "rightToLeft", block: DiffBlock) => {
      // If a diff recompute is in flight (user just typed), block.startLine /
      // endLine were computed from a stale `lines` snapshot and won't match
      // the current editor model. Splicing now would corrupt the buffer.
      // Reject silently; the user can re-click after the diff settles (~50ms).
      if (loading) return;
      const monacoApi = monacoRef.current;
      const targetSide: Side = direction === "leftToRight" ? "right" : "left";
      const targetEditor =
        targetSide === "left" ? leftEditorRef.current : rightEditorRef.current;
      const targetBuf = targetSide === "left" ? leftBuf : rightBuf;
      const args = {
        side: targetSide,
        start:
          direction === "leftToRight"
            ? block.rightTargetStart
            : block.leftTargetStart,
        end:
          direction === "leftToRight"
            ? block.rightTargetEnd
            : block.leftTargetEnd,
        replacement:
          direction === "leftToRight" ? block.leftText : block.rightText,
      };

      // Apply the precise edit to Monaco's model FIRST so the model stays in
      // sync with the soon-to-update buffer.text without a full setValue
      // (which would lose scroll/cursor and re-tokenize). Set mergingRef so
      // the resulting onDidChangeModelContent doesn't trigger our generic
      // onModelEdit path — applyBufferMerge below owns the store update.
      if (
        !targetEditor ||
        !monacoApi ||
        !targetBuf ||
        targetEditor.getModel()?.getValue() !== targetBuf.text
      )
        return;
      const state = useAppStore.getState().fileTabs[tabId];
      if (
        state?.left?.text !== leftDiffText ||
        state?.right?.text !== rightDiffText
      )
        return;
      if (targetEditor && monacoApi && targetBuf) {
        mergingRef.current = true;
        try {
          applyMonacoEdit(
            targetEditor,
            monacoApi,
            args.start,
            args.end,
            args.replacement,
            targetBuf.terminator,
          );
        } finally {
          mergingRef.current = false;
        }
      }
      applyBufferMerge(tabId, {
        ...args,
        actualText: targetEditor.getModel()?.getValue(),
      });
    },
    [
      tabId,
      applyBufferMerge,
      leftBuf,
      rightBuf,
      leftDiffText,
      rightDiffText,
      loading,
    ],
  );

  const canMerge = !leftError && !rightError && !!leftBuf && !!rightBuf;

  const commitPath = useCallback(
    async (side: Side, newPath: string) => {
      if (onPathCommit) return onPathCommit(side, newPath);
      const current = side === "left" ? leftFilePath : rightFilePath;
      if (newPath === current) return true;
      const buf = useAppStore.getState().fileTabs[tabId]?.[side];
      if (buf?.dirty) {
        const ok = await confirm(
          `Discard unsaved changes on the ${side} side?`,
          { title: "Change file", kind: "warning" },
        );
        if (!ok) return false;
      }
      setTabFilePath(tabId, side, newPath);
      return true;
    },
    [tabId, leftFilePath, rightFilePath, setTabFilePath, onPathCommit],
  );

  // Dropping a file from Finder/Explorer on a pane compares that file instead.
  const panesRef = useRef<HTMLDivElement | null>(null);
  const onDropFile = useCallback(
    (side: Side, path: string) => void commitPath(side, path),
    [commitPath],
  );
  const dropSide = useOsFileDrop(panesRef, onDropFile);

  const pickFile = async (side: Side) => {
    if (onPickFile) {
      onPickFile(side);
      return;
    }
    const path = await openFileDialog();
    if (path) await commitPath(side, path);
  };

  const scrollToOffset = useCallback((scrollTop: number) => {
    const left = leftEditorRef.current;
    const right = rightEditorRef.current;
    syncingRef.current = true;
    try {
      left?.setScrollTop(Math.max(0, scrollTop));
      right?.setScrollTop(Math.max(0, scrollTop));
    } finally {
      syncingRef.current = false;
    }
  }, []);

  // Refresh minimap metrics when the diff (and therefore content height) changes.
  useEffect(() => {
    refreshMetrics();
  }, [lines, refreshMetrics]);

  const showErrorRow = !!(leftError || rightError);
  const showFooterRow = showErrorRow;

  return (
    <div className="flex flex-col h-full gap-1">
      {error && (
        <div role="alert" className="p-2 bg-red-50 text-red-700 text-sm">
          Error: {error}
        </div>
      )}
      {leftBuf && rightBuf && loading && !result && (
        <div role="status" className="px-2 text-xs text-gray-500">
          Comparing files…
        </div>
      )}
      {(leftBuf?.operationError || rightBuf?.operationError) && (
        <div role="alert" className="p-2 bg-red-50 text-red-700 text-sm">
          {leftBuf?.operationError ?? rightBuf?.operationError}
        </div>
      )}
      {(leftBuf?.diskStale || rightBuf?.diskStale) && (
        <div className="flex flex-col gap-1">
          {leftBuf?.diskStale && (
            <StaleBanner
              label="Left file changed on disk"
              onReload={() => void reload("left")}
            />
          )}
          {rightBuf?.diskStale && (
            <StaleBanner
              label="Right file changed on disk"
              onReload={() => void reload("right")}
            />
          )}
        </div>
      )}
      <div className="flex gap-2 flex-1 min-h-0">
        <DiffMinimap
          lines={lines}
          leftEditor={leftEditor}
          rightEditor={rightEditor}
          totalContentHeight={scrollMetrics.contentHeight}
          scrollTop={scrollMetrics.scrollTop}
          viewportHeight={scrollMetrics.viewportHeight}
          onJumpToOffset={scrollToOffset}
        />
        <div
          ref={panesRef}
          className="relative flex-1 min-w-0 flex flex-col border border-gray-200 rounded-lg overflow-hidden bg-white"
        >
          {dropSide && (
            <DropTargetOverlay
              side={dropSide}
              layout="inset-0 grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)]"
            />
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] border-b border-gray-200">
            <PaneHeader
              side="left"
              path={leftFilePath}
              onPathCommit={(p) => commitPath("left", p)}
              onPick={onPickFile ? () => onPickFile("left") : undefined}
              disabled={pathsDisabled}
              isDirty={leftBuf?.dirty ?? false}
              hasError={!!leftError}
              onSave={leftBuf ? () => void save("left") : undefined}
            />
            <div className="bg-gray-200" />
            <PaneHeader
              side="right"
              path={rightFilePath}
              onPathCommit={(p) => commitPath("right", p)}
              onPick={onPickFile ? () => onPickFile("right") : undefined}
              disabled={pathsDisabled}
              isDirty={rightBuf?.dirty ?? false}
              hasError={!!rightError}
              onSave={rightBuf ? () => void save("right") : undefined}
            />
          </div>

          {showErrorRow && (
            <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] border-b border-red-200">
              <ErrorCell message={leftError} />
              <div className="bg-gray-200" />
              <ErrorCell message={rightError} />
            </div>
          )}

          <div className="relative flex-1 min-h-0">
            <div className="absolute inset-0 grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)]">
              {leftBuf ? (
                <MonacoDiffPane
                  side="left"
                  modelKey={leftBuf.documentId}
                  text={leftBuf.text}
                  path={leftFilePath}
                  lines={lines}
                  yellowRanges={leftBuf.yellowRanges}
                  readOnly={false}
                  wordWrap={wordWrap}
                  onEditorReady={handleLeftReady}
                  onEditorDispose={handleLeftDispose}
                  onScroll={onLeftScroll}
                  onContentSizeChange={onLeftContentSizeChange}
                  onModelEdit={onLeftModelEdit}
                  onRequestSave={onRequestSave}
                />
              ) : (
                <FilePlaceholder
                  side="left"
                  path={leftFilePath}
                  hasError={!!leftError}
                  onPick={() => void pickFile("left")}
                />
              )}
              <div className="bg-gray-100" />
              {rightBuf ? (
                <MonacoDiffPane
                  side="right"
                  modelKey={rightBuf.documentId}
                  text={rightBuf.text}
                  path={rightFilePath}
                  lines={lines}
                  yellowRanges={rightBuf.yellowRanges}
                  readOnly={false}
                  wordWrap={wordWrap}
                  onEditorReady={handleRightReady}
                  onEditorDispose={handleRightDispose}
                  onScroll={onRightScroll}
                  onContentSizeChange={onRightContentSizeChange}
                  onModelEdit={onRightModelEdit}
                  onRequestSave={onRequestSave}
                />
              ) : (
                <FilePlaceholder
                  side="right"
                  path={rightFilePath}
                  hasError={!!rightError}
                  onPick={() => void pickFile("right")}
                />
              )}
            </div>
            <MergeGutterOverlay
              blocks={blocks}
              leftEditor={leftEditor}
              rightEditor={rightEditor}
              canMerge={canMerge}
              onMerge={merge}
            />
          </div>

          {showFooterRow && (
            <div className="grid grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] border-t border-gray-200">
              <FooterCell show={!!leftError} />
              <div className="bg-gray-200" />
              <FooterCell show={!!rightError} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilePlaceholder({
  side,
  path,
  hasError,
  onPick,
}: {
  side: Side;
  path: string;
  hasError: boolean;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 bg-gray-50 text-sm text-gray-500 text-center">
      {path && !hasError ? (
        <span role="status">Loading {side} file…</span>
      ) : (
        <>
          <button
            type="button"
            onClick={onPick}
            className="px-3 py-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
          >
            Select {side} file
          </button>
          <span className="text-xs">
            {hasError
              ? "Unable to load this file. Choose another file or correct its path above."
              : "Choose a file, paste its path above, or drop it here."}
          </span>
        </>
      )}
    </div>
  );
}

function ErrorCell({ message }: { message: string | null }) {
  if (!message) return <div />;
  return (
    <div className="flex items-center gap-1.5 px-3 py-1 bg-red-50 text-xs text-red-700 min-w-0">
      {/* Feather v4.29.2 alert-triangle icon, MIT. See docs/ASSET_PROVENANCE.md. */}
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="truncate" title={message}>
        {message}
      </span>
    </div>
  );
}

function FooterCell({ show }: { show: boolean }) {
  if (!show) return <div className="h-5 bg-gray-100" />;
  return (
    <div className="flex items-center justify-center h-5 bg-gray-100 text-[11px] text-gray-500 italic">
      Editing disabled
    </div>
  );
}

function StaleBanner({
  label,
  onReload,
}: {
  label: string;
  onReload: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
      <span className="flex-1">{label}</span>
      <button
        type="button"
        onClick={onReload}
        className="px-2 py-0.5 bg-amber-200 hover:bg-amber-300 rounded text-amber-900 font-medium cursor-pointer"
      >
        Reload
      </button>
    </div>
  );
}
