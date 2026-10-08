import { afterEach, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  useBufferDiff,
  type UseBufferDiffState,
} from "../../src/hooks/useBufferDiff";
import { diffText } from "../../src/lib/tauri";
import type { FileDiffResult } from "../../src/types";
vi.mock("../../src/lib/tauri", () => ({ diffText: vi.fn() }));
let root: Root | null = null;
let host: HTMLDivElement | null = null;
let state: UseBufferDiffState;
afterEach(() => {
  root?.unmount();
  host?.remove();
  vi.clearAllMocks();
});
function deferred() {
  let resolve!: (result: FileDiffResult) => void;
  const promise = new Promise<FileDiffResult>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function Harness({ left }: { left: string }) {
  state = useBufferDiff(left, "right", "test-tab");
  return null;
}
it("discards an older diff after newer text completes, and marks edits stale immediately", async () => {
  const old = deferred(),
    next = deferred();
  vi.mocked(diffText)
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(next.promise);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  root.render(<Harness left="old" />);
  await vi.waitFor(() => expect(diffText).toHaveBeenCalledTimes(1));
  root.render(<Harness left="new" />);
  await vi.waitFor(() => expect(diffText).toHaveBeenCalledTimes(2));
  const result: FileDiffResult = { binary: false, too_large: false, lines: [] };
  next.resolve(result);
  await vi.waitFor(() => expect(state.loading).toBe(false));
  const newest = state.result;
  old.resolve({ ...result, binary: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.result).toBe(newest);
  expect(state.result?.binary).toBe(false);
  expect(vi.mocked(diffText).mock.calls[1][3]).toBeGreaterThan(
    vi.mocked(diffText).mock.calls[0][3],
  );
  root.render(<Harness left="edited" />);
  await vi.waitFor(() => expect(state.loading).toBe(true));
});
