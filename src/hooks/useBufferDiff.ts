import { useEffect, useRef, useState } from "react";
import type { FileDiffResult } from "../types";
import { diffText } from "../lib/tauri";

const DEBOUNCE_MS = 50;
let nextGeneration = 0;

export interface UseBufferDiffState {
  result: FileDiffResult | null;
  loading: boolean;
  error: string | null;
}

export function useBufferDiff(
  leftText: string | null,
  rightText: string | null,
  tabId: string,
): UseBufferDiffState {
  const [state, setState] = useState<UseBufferDiffState>({
    result: null,
    loading: true,
    error: null,
  });
  const firstRef = useRef(true);
  const settledInputs = useRef<[string, string] | null>(null);

  useEffect(() => {
    if (leftText === null || rightText === null) {
      setState({ result: null, loading: true, error: null });
      return;
    }

    let cancelled = false;
    const request = ++nextGeneration;

    // Stale-while-revalidate: keep previous result visible on re-runs so the
    // panes don't flash between edits.
    if (firstRef.current) {
      setState({ result: null, loading: true, error: null });
    } else {
      setState((prev) => ({ ...prev, loading: true, error: null }));
    }

    const handle = setTimeout(() => {
      diffText(leftText, rightText, tabId, request)
        .then((result) => {
          if (cancelled) return;
          firstRef.current = false;
          settledInputs.current = [leftText, rightText];
          setState({ result, loading: false, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : String(e);
          setState({ result: null, loading: false, error: msg });
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [leftText, rightText, tabId]);

  return {
    ...state,
    loading:
      state.loading ||
      settledInputs.current?.[0] !== leftText ||
      settledInputs.current?.[1] !== rightText,
  };
}
