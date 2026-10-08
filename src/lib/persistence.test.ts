import { expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue(store),
}));
import { loadComparisonMode, saveComparisonMode } from "./persistence";
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
