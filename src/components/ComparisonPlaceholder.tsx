import type { Side } from "../stores/appStore";
import {
  PathPickerButton,
  type ComparisonItemKind,
  type SelectedComparisonKind,
} from "./PathPickerButton";

interface ComparisonPlaceholderProps {
  side: Side;
  itemKind: ComparisonItemKind;
  path?: string;
  pending?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  onPick: (kind: SelectedComparisonKind) => void;
}

export function ComparisonPlaceholder({
  side,
  itemKind,
  path = "",
  pending = false,
  hasError = false,
  disabled = false,
  onPick,
}: ComparisonPlaceholderProps) {
  const itemLabel = itemKind === "unknown" ? "folder/file" : itemKind;
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 bg-gray-50 text-sm text-gray-500 text-center min-h-0">
      {pending ? (
        <span role="status">
          Checking {side} {itemLabel}…
        </span>
      ) : (
        <>
          <PathPickerButton
            side={side}
            itemKind={itemKind}
            onPick={onPick}
            disabled={disabled}
            variant="select"
          />
          <span className="text-xs">
            {hasError
              ? `Choose another ${itemLabel} or correct its path above.`
              : path && itemKind === "folder"
                ? "Folder selected. Choose the other folder, then compare."
                : `Choose a ${itemLabel}, paste its path above, or drop it here.`}
          </span>
        </>
      )}
    </div>
  );
}
