import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      "react",
      "react-dom/client",
      "monaco-editor",
      "@monaco-editor/react",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/api/core",
      "@tauri-apps/api/webview",
      "@tauri-apps/api/event",
      "@tanstack/react-virtual",
      "zustand",
    ],
  },
  test: {
    include: ["tests/browser/**/*.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
