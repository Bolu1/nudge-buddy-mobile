import { useState } from "react";

/**
 * A key that changes every time `visible` turns on. Give it to a sheet's form
 * component so each opening starts fresh, with state initialised from props —
 * no effect copying props into state. (Adjusts state during render, React's
 * documented pattern for reacting to a prop change.)
 */
export function useOpenKey(visible: boolean): number {
  const [prev, setPrev] = useState(visible);
  const [key, setKey] = useState(0);
  if (visible !== prev) {
    setPrev(visible);
    if (visible) setKey((k) => k + 1);
  }
  return key;
}
