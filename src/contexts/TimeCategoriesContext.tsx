import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { TIME_CATEGORY_LABELS } from '../lib/utils';

export interface TimeCategoryOption {
  id: string;
  key: string;
  label: string;
  active: boolean;
  sort_order: number;
  is_builtin: boolean;
}

interface TimeCategoriesContextType {
  categories: TimeCategoryOption[];
  loading: boolean;
  labelFor: (key: string) => string;
  refresh: () => Promise<void>;
}

function fallbackLabel(key: string) {
  return TIME_CATEGORY_LABELS[key as keyof typeof TIME_CATEGORY_LABELS] || key;
}

const TimeCategoriesContext = createContext<TimeCategoriesContextType>({
  categories: [],
  loading: true,
  labelFor: fallbackLabel,
  refresh: async () => {},
});

// Category options come from vihem_time_categories (per-organisation,
// admin-manageable -- see 20260902120000_time_categories.sql) instead of
// the old fixed 9-value list, so an admin adding e.g. "Städning" shows up
// everywhere a category is picked or displayed without a code change.
export function TimeCategoriesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<TimeCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.organisation_id) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('vihem_time_categories')
      .select('id, key, label, active, sort_order, is_builtin')
      .eq('organisation_id', user.organisation_id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    setCategories((data || []) as TimeCategoryOption[]);
    setLoading(false);
  }, [user?.organisation_id]);

  useEffect(() => { refresh(); }, [refresh]);

  const labelFor = useCallback((key: string) => {
    return categories.find(c => c.key === key)?.label || fallbackLabel(key);
  }, [categories]);

  return (
    <TimeCategoriesContext.Provider value={{ categories, loading, labelFor, refresh }}>
      {children}
    </TimeCategoriesContext.Provider>
  );
}

export function useTimeCategories() {
  return useContext(TimeCategoriesContext);
}
