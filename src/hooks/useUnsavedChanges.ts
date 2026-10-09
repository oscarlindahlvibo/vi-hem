import { registerUnsavedForm } from "../lib/unsavedForms";
import { useEffect, useRef, useState } from "react";
/** Tracks only an open form. No content is persisted or published. */
export function useUnsavedChanges(value: unknown, active: boolean) {
  const serialized = JSON.stringify(value),
    latest = useRef(serialized);
  latest.current = serialized;
  const [baseline, setBaseline] = useState(serialized);
  useEffect(() => {
    if (active) setBaseline(latest.current);
  }, [active]);
  const dirty = active && baseline !== serialized;
  useEffect(() => {
    if (!dirty) return;
    const unregister = registerUnsavedForm();
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);
  return dirty;
}
