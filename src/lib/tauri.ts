import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  ComparisonMode,
  ComparisonResult,
  SaveOutcome,
  FileDiffResult,
  FileReadResult,
} from "../types";

export async function compareFolders(
  leftPath: string,
  rightPath: string,
  mode: ComparisonMode,
): Promise<ComparisonResult> {
  return invoke<ComparisonResult>("compare_folders", {
    leftPath,
    rightPath,
    mode,
  });
}

export async function openFolderDialog(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return selected;
}

export async function openFileDialog(
  defaultPath?: string,
): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    defaultPath,
  });
  return selected;
}

export async function diffText(
  left: string,
  right: string,
  tabId: string,
  generation: number,
): Promise<FileDiffResult> {
  return invoke<FileDiffResult>("diff_text", {
    left,
    right,
    tabId,
    generation,
  });
}

export async function readFileText(path: string): Promise<FileReadResult> {
  return invoke<FileReadResult>("read_file_text", { path });
}

export async function fileVersion(path: string): Promise<string | null> {
  return invoke<string | null>("file_version", { path });
}
export async function saveDocument(
  targetPath: string,
  text: string,
  bom: boolean,
  expectedVersion: string | null,
): Promise<SaveOutcome> {
  return invoke<SaveOutcome>("save_document", {
    targetPath,
    text,
    bom,
    expectedVersion,
  });
}

export async function isDirectory(path: string): Promise<boolean> {
  return invoke<boolean>("is_directory", { path });
}

export interface PlannedFsItem {
  src: string;
  dst: string;
  sourceVersion: string;
  destinationVersion: string | null;
  isDirectory: boolean;
  totalBytes: number;
}
export async function planFsBatch(
  pairs: [string, string][],
  opId: string,
): Promise<PlannedFsItem[]> {
  return invoke<PlannedFsItem[]>("plan_fs_batch", { pairs, opId });
}
export async function executeFsItem(
  item: PlannedFsItem,
  moving: boolean,
  overwrite: boolean,
  opId: string,
): Promise<void> {
  return invoke<void>("execute_fs_item", { item, moving, overwrite, opId });
}

export async function deletePaths(
  paths: string[],
  opId: string,
): Promise<void> {
  return invoke<void>("delete_paths", { paths, opId });
}

export async function startFsOp(): Promise<string> {
  return invoke<string>("start_fs_op");
}

export async function cancelFsOp(opId: string): Promise<void> {
  return invoke<void>("cancel_fs_op", { opId });
}

export async function endFsOp(opId: string): Promise<void> {
  return invoke<void>("end_fs_op", { opId });
}

export interface FsOpProgress {
  itemPath: string;
  opId: string;
  completedItems: number;
  totalItems: number;
  completedBytes: number;
  totalBytes: number;
  currentPath: string;
}

export async function pickFolderForDestination(): Promise<string | null> {
  return openFolderDialog();
}

/** A drag of files from the OS (Finder, Explorer) over the window. */
export type OsFileDragEvent =
  | { type: "over"; x: number; y: number }
  | { type: "drop"; x: number; y: number; paths: string[] }
  | { type: "leave" };

/** Subscribe to OS file drags over the window, with the pointer position in
 *  CSS pixels relative to the viewport. Drags that carry no files (an image
 *  or text dragged within the page) are not reported. Resolves to the
 *  unsubscribe function. */
export async function onOsFileDrag(
  handler: (event: OsFileDragEvent) => void,
): Promise<() => void> {
  // The position is typed as physical pixels, but only Windows reports it
  // that way; on macOS and Linux the webview hands over logical (CSS) pixels
  // unscaled. Normalise to CSS pixels so callers can hit-test with them.
  const isPhysical = navigator.userAgent.includes("Windows");
  const scale = isPhysical ? window.devicePixelRatio : 1;
  let hasFiles = false;

  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "leave") {
      if (hasFiles) handler({ type: "leave" });
      hasFiles = false;
      return;
    }
    if (payload.type !== "over") hasFiles = payload.paths.length > 0;
    if (!hasFiles) return;

    const x = payload.position.x / scale;
    const y = payload.position.y / scale;
    if (payload.type === "drop") {
      hasFiles = false;
      handler({ type: "drop", x, y, paths: payload.paths });
    } else {
      handler({ type: "over", x, y });
    }
  });
}

export async function resolvePaths(paths: string[]): Promise<string[]> {
  return invoke<string[]>("resolve_paths", { paths });
}
