import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listTimeWorkOrders, type TimeWorkOrder } from '../lib/timeWorkOrders';
export function useTimeWorkOrders(organisationId: string | null | undefined, refreshKey: string) {
  const [workOrders, setWorkOrders] = useState<TimeWorkOrder[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setError('');
    listTimeWorkOrders(supabase, organisationId).then(rows => {
      if (!cancelled) setWorkOrders(rows);
    }).catch(err => {
      if (!cancelled) setError(`Kunde inte uppdatera arbetsorderlistan: ${err?.message || 'okänt fel'}`);
    });
    return () => { cancelled = true; };
  }, [organisationId, refreshKey]);
  return { workOrders, error };
}
