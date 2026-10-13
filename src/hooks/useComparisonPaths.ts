import { useCallback, useEffect, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  comparisonPathKind,
  openFileDialog,
  openFolderDialog,
} from "../lib/tauri";
import { useAppStore, type Side } from "../stores/appStore";
import type { ComparisonPathKind } from "../types";
import { refreshComparison } from "./useComparison";

/** Inspect one selected path without loading file contents or scanning folders. */
export function useComparisonPaths(tabId: string) {
  const lifecycleVersion = useAppStore((state) => state.tabLifecycleVersion);
  const [error, setError] = useState<string | null>(null);
  const [pendingSides, setPendingSides] = useState<Set<Side>>(new Set());
  const requests = useRef({ left: 0, right: 0 });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setError(null);
    setPendingSides(new Set());
    return () => {
      mounted.current = false;
      requests.current.left++;
      requests.current.right++;
    };
  }, [tabId, lifecycleVersion]);

  const commitPath = useCallback(
    async (side: Side, rawPath: string, autoCompare = false) => {
      const path = rawPath.trim();
      const state = useAppStore.getState();
      if (state.operating || state.activeTabId !== tabId) return false;
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (!tab) return false;
      const currentPath =
        tab.kind === "file-compare"
          ? side === "left"
            ? tab.leftFilePath
            : tab.rightFilePath
          : tab.kind === "folder-compare"
            ? side === "left"
              ? state.leftPath
              : state.rightPath
            : "";
      const request = ++requests.current[side];
      if (!path || path === currentPath) {
        setPendingSides((previous) => {
          const next = new Set(previous);
          next.delete(side);
          return next;
        });
        setError(null);
        return !!path;
      }
      const lifetime = state.tabLifecycleVersion;
      const isCurrent = () =>
        mounted.current &&
        requests.current[side] === request &&
        useAppStore.getState().activeTabId === tabId &&
        useAppStore.getState().tabLifecycleVersion === lifetime;
      setPendingSides((previous) => new Set([...previous, side]));
      setError(null);
      try {
        const kind = await comparisonPathKind(path);
        if (!isCurrent() || useAppStore.getState().operating) return false;
        const latest = useAppStore.getState();
        const latestTab = latest.tabs.find(
          (candidate) => candidate.id === tabId,
        );
        if (!latestTab) return false;
        const expected =
          latestTab.kind === "compare"
            ? null
            : latestTab.kind === "file-compare"
              ? "file"
              : "folder";
        if (expected && expected !== kind) {
          setError(
            expected === "file"
              ? "Choose a file for this comparison. Folders cannot be compared with files."
              : "Choose a folder for this comparison. Files cannot be compared with folders.",
          );
          return false;
        }
        const buffer = latest.fileTabs[tabId]?.[side];
        if (buffer?.dirty) {
          const discard = await confirm(
            `Discard unsaved changes on the ${side} side?`,
            {
              title: "Change file",
              kind: "warning",
            },
          );
          if (!discard || !isCurrent()) return false;
          const currentBuffer = useAppStore.getState().fileTabs[tabId]?.[side];
          if (
            currentBuffer?.documentId !== buffer.documentId ||
            currentBuffer.revision !== buffer.revision
          )
            return false;
        }
        if (!isCurrent() || useAppStore.getState().operating) return false;
        useAppStore.getState().selectComparisonPath(tabId, side, path, kind);
        if (autoCompare && kind === "folder") await refreshComparison();
        return true;
      } catch (failure) {
        if (isCurrent())
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
        return false;
      } finally {
        if (isCurrent())
          setPendingSides((previous) => {
            const next = new Set(previous);
            next.delete(side);
            return next;
          });
      }
    },
    [tabId],
  );

  const pickPath = useCallback(
    async (side: Side, kind?: ComparisonPathKind) => {
      const state = useAppStore.getState();
      if (state.operating || state.activeTabId !== tabId) return;
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      const selectedKind =
        kind ?? (tab?.kind === "folder-compare" ? "folder" : "file");
      try {
        const path =
          selectedKind === "folder"
            ? await openFolderDialog()
            : await openFileDialog(
                tab?.kind === "file-compare"
                  ? (side === "left" ? tab.leftFilePath : tab.rightFilePath) ||
                      undefined
                  : undefined,
              );
        if (
          path &&
          useAppStore.getState().activeTabId === tabId &&
          useAppStore.getState().tabLifecycleVersion ===
            state.tabLifecycleVersion
        )
          await commitPath(side, path);
      } catch (failure) {
        if (
          mounted.current &&
          useAppStore.getState().activeTabId === tabId &&
          useAppStore.getState().tabLifecycleVersion ===
            state.tabLifecycleVersion
        )
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      }
    },
    [tabId, commitPath],
  );

  return { commitPath, pickPath, pendingSides, error };
}
