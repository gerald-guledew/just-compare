import { beforeEach, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue(store),
}));
import {
  loadComparisonMode,
  loadWordWrap,
  saveComparisonMode,
  saveWordWrap,
} from "./persistence";

beforeEach(() => {
  vi.clearAllMocks();
});
it("defaults missing or invalid settings to Quick and persists Verified", async () => {
  store.get.mockResolvedValue(undefined);
  expect(await loadComparisonMode()).toBe("Quick");
  store.get.mockResolvedValue("invalid");
  expect(await loadComparisonMode()).toBe("Quick");
  store.get.mockResolvedValue("Verified");
  expect(await loadComparisonMode()).toBe("Verified");
  await saveComparisonMode("Verified");
  expect(store.set).toHaveBeenCalledWith("comparisonMode", "Verified");
  expect(store.save).toHaveBeenCalled();
});

it.each([true, false])("loads boolean wrap preference %s", async (wordWrap) => {
  store.get.mockResolvedValue(wordWrap);
  expect(await loadWordWrap()).toBe(wordWrap);
  expect(store.get).toHaveBeenCalledWith("wordWrap");
});

it.each([undefined, null, "true", "false", 1, 0, {}])(
  "defaults missing or invalid wrap preference %j to false",
  async (wordWrap) => {
    store.get.mockResolvedValue(wordWrap);
    expect(await loadWordWrap()).toBe(false);
  },
);

it.each([true, false])(
  "persists boolean wrap preference %s",
  async (wordWrap) => {
    await saveWordWrap(wordWrap);
    expect(store.set).toHaveBeenCalledWith("wordWrap", wordWrap);
    expect(store.save).toHaveBeenCalledOnce();
  },
);
