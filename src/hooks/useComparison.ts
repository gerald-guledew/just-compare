import { useCallback } from "react";
import { openFolderDialog, compareFolders } from "../lib/tauri";
import { selectActiveFolderTab, useAppStore } from "../stores/appStore";
let generation = 0;
export async function refreshComparison(
  preserveExpanded = false,
): Promise<void> {
  const state = useAppStore.getState();
  const {
    leftPath,
    rightPath,
    comparisonMode,
    activeTabId,
    comparisonContextVersion,
  } = state;
  if (!selectActiveFolderTab(state) || !leftPath || !rightPath) return;
  const request = ++generation;
  useAppStore.setState({ error: null, comparing: true });
  const isCurrent = () => {
    const s = useAppStore.getState();
    return (
      generation === request &&
      s.activeTabId === activeTabId &&
      !!selectActiveFolderTab(s) &&
      s.comparisonContextVersion === comparisonContextVersion &&
      s.leftPath === leftPath &&
      s.rightPath === rightPath &&
      s.comparisonMode === comparisonMode
    );
  };
  try {
    const result = await compareFolders(leftPath, rightPath, comparisonMode);
    if (!isCurrent()) return;
    useAppStore.getState().setComparison(result.entries, { preserveExpanded });
    useAppStore.setState({ comparisonWarnings: result.warnings });
  } catch (e) {
    if (isCurrent())
      useAppStore
        .getState()
        .setError(e instanceof Error ? e.message : String(e));
  } finally {
    const current = useAppStore.getState();
    if (generation === request && current.activeTabId === activeTabId)
      useAppStore.setState({ comparing: false });
  }
}
export function useComparison() {
  const pickLeft = useCallback(async () => {
    const { activeTabId, operating, leftPath } = useAppStore.getState();
    if (operating) return;
    const path = await openFolderDialog(leftPath || undefined);
    if (path && !useAppStore.getState().operating)
      useAppStore
        .getState()
        .selectComparisonPath(activeTabId, "left", path, "folder");
  }, []);
  const pickRight = useCallback(async () => {
    const { activeTabId, operating, rightPath } = useAppStore.getState();
    if (operating) return;
    const path = await openFolderDialog(rightPath || undefined);
    if (path && !useAppStore.getState().operating)
      useAppStore
        .getState()
        .selectComparisonPath(activeTabId, "right", path, "folder");
  }, []);
  const compare = useCallback(async () => {
    if (!useAppStore.getState().operating) await refreshComparison();
  }, []);
  return { pickLeft, pickRight, compare };
}
