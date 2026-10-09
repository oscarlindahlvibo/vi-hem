import { useCallback, useEffect, useRef, useState } from 'react';
/** Await the real mutation before clearing a form; keep its values on failure. */
export function useFormSubmission(failureMessage: string) {
  const lock = useRef(false), live = useRef(true);
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = useCallback(async (task: () => unknown | Promise<unknown>) => {
    if (lock.current) return false;
    lock.current = true;
    if (live.current) { setSaving(true); setError(''); }
    try { await task(); return true; }
    catch { if (live.current) setError(failureMessage); return false; }
    finally { lock.current = false; if (live.current) setSaving(false); }
  }, [failureMessage]);
  return { saving, error, run };
}
