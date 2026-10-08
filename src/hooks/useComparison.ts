import { useCallback } from "react";
import { openFolderDialog, compareFolders } from "../lib/tauri";
import { useAppStore } from "../stores/appStore";
let generation = 0;
export async function refreshComparison(
  preserveExpanded = false,
): Promise<void> {
  const { leftPath, rightPath, comparisonMode } = useAppStore.getState();
  if (!leftPath || !rightPath) return;
  const request = ++generation;
  useAppStore.setState({ error: null, comparing: true });
  const isCurrent = () => {
    const s = useAppStore.getState();
    return (
      generation === request &&
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
    if (generation === request) useAppStore.setState({ comparing: false });
  }
}
export function useComparison() {
  const pickLeft = useCallback(async () => {
    const path = await openFolderDialog();
    if (path && !useAppStore.getState().operating)
      useAppStore.getState().setLeftPath(path);
  }, []);
  const pickRight = useCallback(async () => {
    const path = await openFolderDialog();
    if (path && !useAppStore.getState().operating)
      useAppStore.getState().setRightPath(path);
  }, []);
  const compare = useCallback(async () => {
    if (!useAppStore.getState().operating) await refreshComparison();
  }, []);
  return { pickLeft, pickRight, compare };
}
