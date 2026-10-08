import { useCallback, useEffect } from "react";
import { readFileText } from "../lib/tauri";
import {
  documentBuffer,
  reloadDocument,
  saveTab,
  checkOpenDocuments,
} from "../lib/documents";
import { useAppStore, type Side } from "../stores/appStore";

export function useFileBuffers(
  tabId: string,
  leftPath: string,
  rightPath: string,
) {
  useEffect(() => {
    const state = useAppStore.getState();
    state.initFileTab(tabId);
    let cancelled = false;
    for (const [side, path] of [
      ["left", leftPath],
      ["right", rightPath],
    ] as const) {
      if (state.fileTabs[tabId]?.[side]) continue;
      void readFileText(path)
        .then((r) => {
          if (!cancelled)
            useAppStore
              .getState()
              .setFileTabBuffer(tabId, side, documentBuffer(r));
        })
        .catch((e: unknown) => {
          if (!cancelled)
            useAppStore
              .getState()
              .setLoadError(
                tabId,
                side,
                e instanceof Error ? e.message : String(e),
              );
        });
    }
    void checkOpenDocuments();
    return () => {
      cancelled = true;
    };
  }, [tabId, leftPath, rightPath]);
  const save = useCallback(
    (side: Side | "all") => saveTab(tabId, side),
    [tabId],
  );
  const reload = useCallback(
    (side: Side) => reloadDocument(tabId, side),
    [tabId],
  );
  return { save, reload };
}
