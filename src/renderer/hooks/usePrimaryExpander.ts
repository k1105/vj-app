import { useState } from "react";

/**
 * Shared logic for the primary/secondary param expander pattern.
 * Used by both AssetParamsPanel and PostFXBar.
 *
 * Returns `primary` and `secondary` as separate lists so callers can render
 * the MORE/LESS toggle between them — keeping the button pinned just below
 * primary params regardless of whether secondary is expanded.
 */
export function usePrimaryExpander<T>(
  items: T[],
  isPrimary: (item: T) => boolean,
) {
  const [showAll, setShowAll] = useState(false);
  const hasPrimary = items.some(isPrimary);
  const primary = hasPrimary ? items.filter(isPrimary) : items;
  const secondary = hasPrimary ? items.filter((i) => !isPrimary(i)) : [];
  const secondaryCount = secondary.length;
  return { primary, secondary, hasPrimary, showAll, setShowAll, secondaryCount };
}
