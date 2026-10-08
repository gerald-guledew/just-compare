import type { ComparisonMode } from "../types";
import { load, type Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "settings.json";
const KEY_LEFT = "leftPath";
const KEY_RIGHT = "rightPath";

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE);
  }
  return storePromise;
}

export interface PersistedPaths {
  leftPath: string | null;
  rightPath: string | null;
}

export async function loadPaths(): Promise<PersistedPaths> {
  const store = await getStore();
  const leftPath = (await store.get<string>(KEY_LEFT)) ?? null;
  const rightPath = (await store.get<string>(KEY_RIGHT)) ?? null;
  return { leftPath, rightPath };
}

export async function savePaths(
  leftPath: string | null,
  rightPath: string | null,
): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LEFT, leftPath);
  await store.set(KEY_RIGHT, rightPath);
  await store.save();
}

export async function loadComparisonMode(): Promise<ComparisonMode> {
  const mode = await (await getStore()).get<string>("comparisonMode");
  return mode === "Verified" ? "Verified" : "Quick";
}
export async function saveComparisonMode(mode: ComparisonMode): Promise<void> {
  const store = await getStore();
  await store.set("comparisonMode", mode);
  await store.save();
}
