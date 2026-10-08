import type { DiffLine } from "../../types";
import type { Side } from "../../stores/appStore";

export interface ViewZoneSpec {
  afterLineNumber: number;
  heightInLines: number;
}

export function buildViewZones(lines: DiffLine[], side: Side): ViewZoneSpec[] {
  const zones: ViewZoneSpec[] = [];
  let lastRealLine = 0;
  let pendingPad = 0;

  const flush = () => {
    if (pendingPad > 0) {
      zones.push({ afterLineNumber: lastRealLine, heightInLines: pendingPad });
      pendingPad = 0;
    }
  };

  for (const line of lines) {
    const num = side === "left" ? line.left_num : line.right_num;
    if (num === null) {
      pendingPad += 1;
    } else {
      flush();
      lastRealLine = num;
    }
  }
  flush();
  return zones;
}
