import { useAppStore } from "../../stores/appStore";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

loader.config({ monaco });

export const MONACO_LIGHT_THEME = "vs";

// Keep models across tab switches. Never dispose a model still attached to an
// editor: React will detach it when it commits the replacement document.
function releaseRetiredModels() {
  const alive = new Set(
    Object.values(useAppStore.getState().fileTabs).flatMap((tab) => [
      tab.left?.documentId,
      tab.right?.documentId,
    ]),
  );
  const attached = new Set(
    monaco.editor.getEditors().map((editor) => editor.getModel()),
  );
  for (const model of monaco.editor.getModels()) {
    if (
      model.uri.scheme === "justcompare" &&
      !alive.has(model.uri.path.slice(1)) &&
      !attached.has(model)
    )
      model.dispose();
  }
}
useAppStore.subscribe(releaseRetiredModels);
monaco.editor.onDidCreateEditor((editor) => {
  const change = editor.onDidChangeModel(() =>
    queueMicrotask(releaseRetiredModels),
  );
  const dispose = editor.onDidDispose(() => {
    change.dispose();
    dispose.dispose();
    queueMicrotask(releaseRetiredModels);
  });
});
