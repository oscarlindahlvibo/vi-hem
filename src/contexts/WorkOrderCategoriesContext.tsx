import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { WO_CATEGORIES } from '../lib/utils';

export interface WorkOrderCategoryOption {
  id: string;
  key: string;
  label: string;
  active: boolean;
  sort_order: number;
  is_builtin: boolean;
}

interface WorkOrderCategoriesContextType {
  categories: WorkOrderCategoryOption[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const WorkOrderCategoriesContext = createContext<WorkOrderCategoriesContextType>({
  categories: [],
  loading: true,
  refresh: async () => {},
});

// Category options come from vihem_work_order_categories (per-organisation,
// admin-manageable -- see 20260916120000_work_order_categories.sql) instead
// of the old fixed WO_CATEGORIES list, so an admin adding a category shows
// up everywhere a work order category is picked without a code change.
// vihem_work_orders.category has always been a freeform text column (no
// FK), storing the label itself -- so unlike time categories, the picker
// uses `label` as the option value, not `key` (key only exists here for
// the admin table's own identity/uniqueness).
export function WorkOrderCategoriesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<WorkOrderCategoryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.organisation_id) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('vihem_work_order_categories')
      .select('id, key, label, active, sort_order, is_builtin')
      .eq('organisation_id', user.organisation_id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    setCategories((data && data.length > 0 ? data : WO_CATEGORIES.map((label, index) => ({ id: label, key: label, label, active: true, sort_order: index, is_builtin: true }))) as WorkOrderCategoryOption[]);
    setLoading(false);
  }, [user?.organisation_id]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <WorkOrderCategoriesContext.Provider value={{ categories, loading, refresh }}>
      {children}
    </WorkOrderCategoriesContext.Provider>
  );
}

export function useWorkOrderCategories() {
  return useContext(WorkOrderCategoriesContext);
}
