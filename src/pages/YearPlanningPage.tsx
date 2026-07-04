import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutList,
  ListChecks,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, Button, Card, EmptyState, Input, LoadingPage, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { formatDate } from '../lib/utils';
import type { PlanningCategory, PlanningItem, PlanningItemStatus, PlanningItemType, Profile } from '../types';

type PlanningForm = {
  title: string;
  description: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  item_type: PlanningItemType;
  priority: PlanningItem['priority'];
  status: PlanningItemStatus;
  responsible_user_id: string;
};

type PlanningViewMode = 'wheel' | 'list';

type CategoryForm = {
  id: string;
  category_key: string;
  label: string;
  fill_color: string;
  stroke_color: string;
  text_color: string;
  sort_order: string;
  active: boolean;
  system_key: boolean;
};

const today = new Date();
const currentYear = today.getFullYear();

const defaultForm = (): PlanningForm => {
  const date = localDateKey(new Date());
  return {
    title: '',
    description: '',
    start_date: date,
    start_time: '09:00',
    end_date: '',
    end_time: '',
    item_type: 'custom',
    priority: 'normal',
    status: 'planned',
    responsible_user_id: '',
  };
};

const priorityOptions = [
  { value: 'low', label: 'Låg' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Hög' },
  { value: 'urgent', label: 'Akut' },
];

const priorityLabels: Record<PlanningItem['priority'], string> = {
  low: 'Låg',
  normal: 'Normal',
  high: 'Hög',
  urgent: 'Akut',
};

const priorityClasses: Record<PlanningItem['priority'], string> = {
  low: 'bg-slate-100 text-slate-600',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
};

const statusOptions: { value: PlanningItemStatus; label: string }[] = [
  { value: 'planned', label: 'Planerad' },
  { value: 'in_progress', label: 'Pågår' },
  { value: 'done', label: 'Klar' },
  { value: 'cancelled', label: 'Avbruten' },
];

const statusLabels: Record<PlanningItemStatus, string> = {
  planned: 'Planerad',
  in_progress: 'Pågår',
  done: 'Klar',
  cancelled: 'Avbruten',
};

const statusClasses: Record<PlanningItemStatus, string> = {
  planned: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  cancelled: 'bg-slate-200 text-slate-500',
};

const defaultCategoryRows: PlanningCategory[] = [
  { id: 'default-maintenance', organisation_id: '', category_key: 'maintenance', label: 'Underhåll', fill_color: '#fef3c7', stroke_color: '#f59e0b', text_color: '#b45309', sort_order: 10, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-inspection', organisation_id: '', category_key: 'inspection', label: 'Besiktning', fill_color: '#dcfce7', stroke_color: '#4ade80', text_color: '#15803d', sort_order: 20, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-work-order', organisation_id: '', category_key: 'work_order', label: 'Arbetsorder', fill_color: '#dbeafe', stroke_color: '#60a5fa', text_color: '#1d4ed8', sort_order: 30, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-meeting', organisation_id: '', category_key: 'meeting', label: 'Möten', fill_color: '#ede9fe', stroke_color: '#8b5cf6', text_color: '#6d28d9', sort_order: 40, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-project', organisation_id: '', category_key: 'project', label: 'Projekt', fill_color: '#ccfbf1', stroke_color: '#14b8a6', text_color: '#0f766e', sort_order: 50, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-inventory', organisation_id: '', category_key: 'inventory', label: 'Inventarier', fill_color: '#e0f2fe', stroke_color: '#38bdf8', text_color: '#0369a1', sort_order: 60, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-absence', organisation_id: '', category_key: 'absence', label: 'Frånvaro', fill_color: '#fee2e2', stroke_color: '#f87171', text_color: '#b91c1c', sort_order: 70, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
  { id: 'default-custom', organisation_id: '', category_key: 'custom', label: 'Övrigt', fill_color: '#f1f5f9', stroke_color: '#94a3b8', text_color: '#475569', sort_order: 80, active: true, system_key: true, created_by: null, created_at: '', updated_at: '' },
];

const defaultCategoryForm: CategoryForm = {
  id: '',
  category_key: '',
  label: '',
  fill_color: '#f1f5f9',
  stroke_color: '#64748b',
  text_color: '#334155',
  sort_order: '90',
  active: true,
  system_key: false,
};

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function toDateInput(value: string | null | undefined) {
  if (!value) return '';
  return localDateKey(new Date(value));
}

function toTimeInput(value: string | null | undefined) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function composeDateTime(date: string, time: string) {
  if (!date) return '';
  return new Date(`${date}T${time || '09:00'}:00`).toISOString();
}

function monthName(year: number, monthIndex: number) {
  return new Date(year, monthIndex, 1).toLocaleDateString('sv-SE', { month: 'long' });
}

function monthKeyFromDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isInMonth(value: string, year: number, monthIndex: number) {
  const date = new Date(value);
  return date.getFullYear() === year && date.getMonth() === monthIndex;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDegrees: number) {
  const angleRadians = (angleDegrees - 90) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angleRadians),
    y: cy + radius * Math.sin(angleRadians),
  };
}

function describeArc(cx: number, cy: number, innerRadius: number, outerRadius: number, startAngle: number, endAngle: number) {
  const outerStart = polarToCartesian(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, endAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, endAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

function daysInYear(year: number) {
  return new Date(year, 1, 29).getMonth() === 1 ? 366 : 365;
}

function dayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date.getTime() - start.getTime()) / 86400000) + 1;
}

function angleForDate(date: Date, year: number) {
  return ((dayOfYear(date) - 1) / daysInYear(year)) * 360;
}

function monthAngleRange(year: number, monthIndex: number) {
  const startAngle = angleForDate(new Date(year, monthIndex, 1), year);
  const endAngle = monthIndex === 11
    ? 360
    : angleForDate(new Date(year, monthIndex + 1, 1), year);
  return { startAngle, endAngle };
}

function rotationForText(angle: number) {
  const normalized = ((angle % 360) + 360) % 360;
  return normalized > 90 && normalized < 270 ? angle + 180 : angle;
}

function truncateLabel(label: string, maxLength: number) {
  return label.length > maxLength ? `${label.slice(0, Math.max(1, maxLength - 1))}…` : label;
}

function categoryKeyFromLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'egen_kategori';
}

function categoryStyle(category?: PlanningCategory) {
  return {
    label: category?.label || 'Övrigt',
    fill: category?.fill_color || '#f1f5f9',
    stroke: category?.stroke_color || '#94a3b8',
    text: category?.text_color || '#475569',
  };
}

function isMissingCategorySchema(error: any) {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('schema cache');
}

export function YearPlanningPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<PlanningCategory[]>(defaultCategoryRows);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanningItem | null>(null);
  const [editingCategory, setEditingCategory] = useState<PlanningCategory | null>(null);
  const [form, setForm] = useState<PlanningForm>(defaultForm);
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(defaultCategoryForm);
  const [saveError, setSaveError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<PlanningItemStatus | 'active' | 'all'>('active');
  const [viewMode, setViewMode] = useState<PlanningViewMode>('wheel');
  const [visibleTypes, setVisibleTypes] = useState<PlanningItemType[]>(defaultCategoryRows.map(category => category.category_key));
  const canManageCategories = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    fetchData();
  }, [selectedYear, user?.organisation_id]);

  async function fetchData() {
    if (!user?.organisation_id) return;
    setLoading(true);
    try {
      const start = new Date(selectedYear, 0, 1).toISOString();
      const end = new Date(selectedYear, 11, 31, 23, 59, 59).toISOString();
      const [itemsResult, staffResult, categoriesResult] = await Promise.all([
        supabase
          .from('vihem_planning_items')
          .select('*, responsible:vihem_profiles!responsible_user_id(id, name, email, role), creator:vihem_profiles!created_by(id, name, email, role)')
          .eq('organisation_id', user.organisation_id)
          .is('deleted_at', null)
          .gte('start_at', start)
          .lte('start_at', end)
          .order('start_at', { ascending: true }),
        supabase
          .from('vihem_profiles')
          .select('id, name, email, phone, role, active, avatar_url, organisation_id, auth_method, bankid_personal_number, bankid_linked_at, created_at, updated_at')
          .eq('organisation_id', user.organisation_id)
          .in('role', ['staff', 'admin'])
          .eq('active', true)
          .order('name', { ascending: true }),
        supabase
          .from('vihem_planning_categories')
          .select('*')
          .eq('organisation_id', user.organisation_id)
          .order('sort_order', { ascending: true }),
      ]);

      if (itemsResult.error) throw itemsResult.error;
      if (staffResult.error) throw staffResult.error;
      if (categoriesResult.error && !isMissingCategorySchema(categoriesResult.error)) throw categoriesResult.error;
      setItems((itemsResult.data || []) as unknown as PlanningItem[]);
      setStaff((staffResult.data || []) as Profile[]);
      const nextCategories = categoriesResult.error
        ? defaultCategoryRows
        : ((categoriesResult.data?.length ? categoriesResult.data : defaultCategoryRows) as PlanningCategory[]);
      setCategories(nextCategories);
      setVisibleTypes(current => {
        if (current.length === 0) return current;
        const validKeys = new Set(nextCategories.filter(category => category.active).map(category => category.category_key));
        const nextVisible = current.filter(type => validKeys.has(type));
        return nextVisible.length > 0 ? nextVisible : nextCategories.filter(category => category.active).map(category => category.category_key);
      });
    } catch (error) {
      console.error('Error fetching year planning:', error);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal(monthIndex?: number) {
    const nextForm = defaultForm();
    if (typeof monthIndex === 'number') {
      nextForm.start_date = localDateKey(new Date(selectedYear, monthIndex, 1));
    }
    setEditingItem(null);
    setForm(nextForm);
    setSaveError('');
    setShowModal(true);
  }

  function openEditModal(item: PlanningItem) {
    setEditingItem(item);
    setForm({
      title: item.title,
      description: item.description || '',
      start_date: toDateInput(item.start_at),
      start_time: toTimeInput(item.start_at) || '09:00',
      end_date: toDateInput(item.end_at),
      end_time: toTimeInput(item.end_at),
      item_type: item.item_type,
      priority: item.priority,
      status: item.status,
      responsible_user_id: item.responsible_user_id || '',
    });
    setSaveError('');
    setShowModal(true);
  }

  async function handleSave() {
    if (!user?.organisation_id) return;
    setSaveError('');

    if (!form.title.trim()) {
      setSaveError('Ange en rubrik.');
      return;
    }

    if (!form.start_date) {
      setSaveError('Ange startdatum.');
      return;
    }

    const startAt = composeDateTime(form.start_date, form.start_time);
    const endAt = form.end_date ? composeDateTime(form.end_date, form.end_time || form.start_time) : null;

    if (endAt && new Date(endAt).getTime() < new Date(startAt).getTime()) {
      setSaveError('Sluttiden kan inte vara före starttiden.');
      return;
    }

    try {
      setSaving(true);
      const payload = {
        organisation_id: user.organisation_id,
        title: form.title.trim(),
        description: form.description.trim(),
        start_at: startAt,
        end_at: endAt,
        item_type: form.item_type,
        priority: form.priority,
        status: form.status,
        responsible_user_id: form.responsible_user_id || null,
      };

      if (editingItem) {
        const { error } = await supabase
          .from('vihem_planning_items')
          .update(payload)
          .eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('vihem_planning_items')
          .insert({ ...payload, created_by: user.id });
        if (error) throw error;
      }

      const savedDate = new Date(startAt);
      const savedYear = savedDate.getFullYear();
      setShowModal(false);
      setEditingItem(null);
      setForm(defaultForm());
      setSelectedMonth(viewMode === 'wheel' ? 'all' : savedDate.getMonth());
      setVisibleTypes(current => current.includes(payload.item_type) ? current : [...current, payload.item_type]);
      if (statusFilter === 'active' && ['done', 'cancelled'].includes(payload.status)) {
        setStatusFilter('all');
      }
      if (savedYear !== selectedYear) {
        setSelectedYear(savedYear);
      } else {
        await fetchData();
      }
    } catch (error: any) {
      setSaveError(error.message || 'Kunde inte spara planeringspunkten.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(item: PlanningItem, status: PlanningItemStatus) {
    const { error } = await supabase
      .from('vihem_planning_items')
      .update({ status })
      .eq('id', item.id);

    if (error) {
      alert('Kunde inte uppdatera status.');
      return;
    }

    setItems(current => current.map(row => row.id === item.id ? { ...row, status } : row));
  }

  async function deleteItem(item: PlanningItem) {
    if (!window.confirm(`Ta bort "${item.title}" från årsplaneringen?`)) return;
    const { error } = await supabase
      .from('vihem_planning_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', item.id);

    if (error) {
      alert('Kunde inte ta bort planeringspunkten.');
      return;
    }

    setItems(current => current.filter(row => row.id !== item.id));
  }

  const activeCategories = useMemo(() => {
    return categories
      .filter(category => category.active)
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  }, [categories]);

  const categoryByKey = useMemo(() => {
    return categories.reduce((acc, category) => {
      acc[category.category_key] = category;
      return acc;
    }, {} as Record<string, PlanningCategory>);
  }, [categories]);

  const typeOptions = useMemo(() => {
    return activeCategories.map(category => ({ value: category.category_key, label: category.label }));
  }, [activeCategories]);

  const typeLabels = useMemo(() => {
    return categories.reduce((acc, category) => {
      acc[category.category_key] = category.label;
      return acc;
    }, {} as Record<string, string>);
  }, [categories]);

  const wheelTypes = useMemo(() => activeCategories.map(category => category.category_key), [activeCategories]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (selectedMonth !== 'all' && !isInMonth(item.start_at, selectedYear, selectedMonth)) return false;
      if (!visibleTypes.includes(item.item_type)) return false;
      if (statusFilter === 'active') return !['done', 'cancelled'].includes(item.status);
      if (statusFilter !== 'all') return item.status === statusFilter;
      return true;
    });
  }, [items, selectedMonth, selectedYear, statusFilter, visibleTypes]);

  const itemsByMonth = useMemo(() => {
    const grouped: Record<string, PlanningItem[]> = {};
    filteredItems.forEach(item => {
      const key = monthKeyFromDate(item.start_at);
      grouped[key] = [...(grouped[key] || []), item];
    });
    return grouped;
  }, [filteredItems]);

  const yearStats = useMemo(() => {
    const active = items.filter(item => !['done', 'cancelled'].includes(item.status)).length;
    const done = items.filter(item => item.status === 'done').length;
    const urgent = items.filter(item => item.priority === 'urgent' && !['done', 'cancelled'].includes(item.status)).length;
    const upcoming = items.filter(item => new Date(item.start_at).getTime() >= Date.now() && !['done', 'cancelled'].includes(item.status)).length;
    return { active, done, urgent, upcoming };
  }, [items]);

  const monthSummaries = useMemo(() => {
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const monthItems = items.filter(item => isInMonth(item.start_at, selectedYear, monthIndex));
      return {
        monthIndex,
        total: monthItems.length,
        active: monthItems.filter(item => !['done', 'cancelled'].includes(item.status)).length,
        done: monthItems.filter(item => item.status === 'done').length,
        urgent: monthItems.filter(item => item.priority === 'urgent' && !['done', 'cancelled'].includes(item.status)).length,
      };
    });
  }, [items, selectedYear]);

  const visibleMonths = selectedMonth === 'all'
    ? Array.from({ length: 12 }, (_, index) => index)
    : [selectedMonth];

  const typeCounts = useMemo(() => {
    return wheelTypes.reduce((acc, type) => {
      acc[type] = items.filter(item => item.item_type === type).length;
      return acc;
    }, {} as Record<PlanningItemType, number>);
  }, [items, wheelTypes]);

  const toggleType = (type: PlanningItemType) => {
    setVisibleTypes(current => current.includes(type)
      ? current.filter(value => value !== type)
      : [...current, type]
    );
  };

  function openCategoryModal(category?: PlanningCategory) {
    setEditingCategory(category || null);
    setCategoryForm(category ? {
      id: category.id,
      category_key: category.category_key,
      label: category.label,
      fill_color: category.fill_color,
      stroke_color: category.stroke_color,
      text_color: category.text_color,
      sort_order: String(category.sort_order),
      active: category.active,
      system_key: category.system_key,
    } : {
      ...defaultCategoryForm,
      sort_order: String((categories.reduce((max, category) => Math.max(max, category.sort_order), 0) || 80) + 10),
    });
    setCategoryError('');
    setShowCategoryModal(true);
  }

  async function handleSaveCategory() {
    if (!user?.organisation_id) return;
    setCategoryError('');
    const label = categoryForm.label.trim();
    const categoryKey = (categoryForm.category_key || categoryKeyFromLabel(label)).trim();

    if (!label) {
      setCategoryError('Ange namn på ringen.');
      return;
    }
    if (!/^[a-z0-9_:-]{1,64}$/.test(categoryKey)) {
      setCategoryError('Nyckeln får bara innehålla små bokstäver, siffror, bindestreck, kolon och understreck.');
      return;
    }
    if (!editingCategory && categories.some(category => category.category_key === categoryKey)) {
      setCategoryError('Det finns redan en ring med den nyckeln.');
      return;
    }

    setSavingCategory(true);
    try {
      const payload = {
        organisation_id: user.organisation_id,
        category_key: categoryKey,
        label,
        fill_color: categoryForm.fill_color,
        stroke_color: categoryForm.stroke_color,
        text_color: categoryForm.text_color,
        sort_order: parseInt(categoryForm.sort_order, 10) || 0,
        active: categoryForm.active,
        system_key: categoryForm.system_key,
        created_by: user.id,
      };

      const result = editingCategory
        ? await supabase.from('vihem_planning_categories').update(payload).eq('id', editingCategory.id)
        : await supabase.from('vihem_planning_categories').insert(payload);

      if (result.error) throw result.error;
      setShowCategoryModal(false);
      setEditingCategory(null);
      await fetchData();
    } catch (error: any) {
      setCategoryError(isMissingCategorySchema(error)
        ? 'Databasen saknar kategoritabellen. Kör senaste migreringarna på servern.'
        : (error.message || 'Kunde inte spara ringen.')
      );
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleDeleteCategory(category: PlanningCategory) {
    const usedCount = items.filter(item => item.item_type === category.category_key).length;
    if (usedCount > 0) {
      alert(`Ringen används av ${usedCount} planeringspunkter. Inaktivera den istället eller flytta punkterna först.`);
      return;
    }
    if (!window.confirm(`Ta bort ringen "${category.label}"?`)) return;

    const { error } = await supabase.from('vihem_planning_categories').delete().eq('id', category.id);
    if (error) {
      alert(isMissingCategorySchema(error) ? 'Databasen saknar kategoritabellen.' : 'Kunde inte ta bort ringen.');
      return;
    }
    await fetchData();
  }

  if (loading) return <LoadingPage />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Årsplanering"
        subtitle="Planera återkommande arbeten, besiktningar, möten, projekt och andra viktiga punkter under året."
        icon={CalendarDays}
        action={
          <Button onClick={() => openCreateModal(typeof selectedMonth === 'number' ? selectedMonth : undefined)} className="w-full sm:w-auto">
            <Plus className="w-4 h-4" /> Ny planeringspunkt
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Aktiva punkter</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{yearStats.active}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Kommande</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{yearStats.upcoming}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Akuta</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{yearStats.urgent}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Klara</p>
          <p className="text-2xl font-bold text-green-700 mt-1">{yearStats.done}</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedYear(year => year - 1)} aria-label="Föregående år">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="min-w-24 text-center">
              <p className="text-xs text-slate-500">År</p>
              <p className="text-lg font-bold text-slate-800">{selectedYear}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSelectedYear(year => year + 1)} aria-label="Nästa år">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:w-[28rem]">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-slate-700">Vy</span>
              <div className="grid grid-cols-2 rounded-lg border border-slate-300 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('wheel')}
                  className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'wheel' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <RotateCw className="w-4 h-4" /> Årshjul
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === 'list' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <LayoutList className="w-4 h-4" /> Lista
                </button>
              </div>
            </div>
            <Select
              label="Månad"
              value={String(selectedMonth)}
              onChange={event => setSelectedMonth(event.target.value === 'all' ? 'all' : Number(event.target.value))}
              options={[
                { value: 'all', label: 'Alla månader' },
                ...Array.from({ length: 12 }, (_, index) => ({ value: String(index), label: monthName(selectedYear, index) })),
              ]}
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as PlanningItemStatus | 'active' | 'all')}
              options={[
                { value: 'active', label: 'Aktiva' },
                { value: 'all', label: 'Alla' },
                ...statusOptions,
              ]}
            />
          </div>
        </div>
      </Card>

      {viewMode === 'list' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {monthSummaries.map(summary => (
            <button
              key={summary.monthIndex}
              type="button"
              onClick={() => setSelectedMonth(selectedMonth === summary.monthIndex ? 'all' : summary.monthIndex)}
              className={`text-left rounded-lg border p-3 transition-all ${
                selectedMonth === summary.monthIndex
                  ? 'border-blue-400 bg-blue-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className="text-sm font-semibold text-slate-800 capitalize">{monthName(selectedYear, summary.monthIndex)}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <span>{summary.active} aktiva</span>
                <span>{summary.done} klara</span>
              </div>
              {summary.urgent > 0 && <p className="mt-1 text-xs font-medium text-red-600">{summary.urgent} akut</p>}
            </button>
          ))}
        </div>
      )}

      {viewMode === 'wheel' ? (
        <YearWheelView
          items={filteredItems}
          allItems={items}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          visibleTypes={visibleTypes}
          typeCounts={typeCounts}
          categories={activeCategories}
          categoryByKey={categoryByKey}
          onToggleType={toggleType}
          onShowAllTypes={() => setVisibleTypes(wheelTypes)}
          onHideAllTypes={() => setVisibleTypes([])}
          onEditCategory={openCategoryModal}
          onCreateCategory={() => openCategoryModal()}
          onEdit={openEditModal}
          onCreate={openCreateModal}
          canManageCategories={canManageCategories}
        />
      ) : filteredItems.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ListChecks className="w-12 h-12" />}
            title="Inga planeringspunkter här ännu"
            description="Lägg in årets återkommande arbeten, möten, besiktningar och viktiga deadlines."
            action={<Button onClick={() => openCreateModal(typeof selectedMonth === 'number' ? selectedMonth : undefined)}><Plus className="w-4 h-4" /> Lägg till punkt</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {visibleMonths.map(monthIndex => {
            const key = `${selectedYear}-${String(monthIndex + 1).padStart(2, '0')}`;
            const monthItems = itemsByMonth[key] || [];
            if (monthItems.length === 0 && selectedMonth !== 'all') return null;
            if (monthItems.length === 0) return null;

            return (
              <Card key={key} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div>
                    <h2 className="text-sm font-bold text-slate-800 capitalize">{monthName(selectedYear, monthIndex)}</h2>
                    <p className="text-xs text-slate-500">{monthItems.length} planeringspunkter</p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => openCreateModal(monthIndex)}>
                    <Plus className="w-4 h-4" /> Lägg till
                  </Button>
                </div>
                <div className="divide-y divide-slate-100">
                  {monthItems.map(item => (
                    <PlanningItemRow
                      key={item.id}
                      item={item}
                      onEdit={() => openEditModal(item)}
                      onDelete={() => deleteItem(item)}
                      onStatus={status => updateStatus(item, status)}
                      typeLabel={typeLabels[item.item_type] || item.item_type}
                    />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingItem(null);
          setSaveError('');
        }}
        title={editingItem ? 'Redigera planeringspunkt' : 'Ny planeringspunkt'}
        size="lg"
      >
        <div className="space-y-4">
          {saveError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {saveError}
            </div>
          )}
          <Input label="Rubrik" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} />
          <Textarea
            label="Beskrivning"
            rows={3}
            value={form.description}
            onChange={event => setForm({ ...form, description: event.target.value })}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Typ"
              value={form.item_type}
              onChange={event => setForm({ ...form, item_type: event.target.value as PlanningItemType })}
              options={typeOptions}
            />
            <Select
              label="Ansvarig"
              value={form.responsible_user_id}
              onChange={event => setForm({ ...form, responsible_user_id: event.target.value })}
              options={[
                { value: '', label: 'Ingen ansvarig' },
                ...staff.map(member => ({ value: member.id, label: member.name })),
              ]}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Startdatum" type="date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} />
            <Input label="Starttid" type="time" value={form.start_time} onChange={event => setForm({ ...form, start_time: event.target.value })} />
            <Input label="Slutdatum" type="date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })} />
            <Input label="Sluttid" type="time" value={form.end_time} onChange={event => setForm({ ...form, end_time: event.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Prioritet"
              value={form.priority}
              onChange={event => setForm({ ...form, priority: event.target.value as PlanningItem['priority'] })}
              options={priorityOptions}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={event => setForm({ ...form, status: event.target.value as PlanningItemStatus })}
              options={statusOptions}
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Avbryt</Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">{editingItem ? 'Spara ändringar' : 'Skapa punkt'}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showCategoryModal}
        onClose={() => {
          setShowCategoryModal(false);
          setEditingCategory(null);
          setCategoryError('');
        }}
        title={editingCategory ? 'Redigera ring' : 'Ny ring'}
        size="lg"
      >
        <div className="space-y-4">
          {categoryError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {categoryError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Namn"
              value={categoryForm.label}
              onChange={event => setCategoryForm(current => ({
                ...current,
                label: event.target.value,
                category_key: current.id ? current.category_key : categoryKeyFromLabel(event.target.value),
              }))}
            />
            <Input
              label="Nyckel"
              value={categoryForm.category_key}
              disabled={Boolean(editingCategory)}
              onChange={event => setCategoryForm({ ...categoryForm, category_key: categoryKeyFromLabel(event.target.value) })}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Input label="Sortering" type="number" value={categoryForm.sort_order} onChange={event => setCategoryForm({ ...categoryForm, sort_order: event.target.value })} />
            <Input label="Bakgrund" type="color" value={categoryForm.fill_color} onChange={event => setCategoryForm({ ...categoryForm, fill_color: event.target.value })} />
            <Input label="Fältfärg" type="color" value={categoryForm.stroke_color} onChange={event => setCategoryForm({ ...categoryForm, stroke_color: event.target.value })} />
            <Input label="Textfärg" type="color" value={categoryForm.text_color} onChange={event => setCategoryForm({ ...categoryForm, text_color: event.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={categoryForm.active}
              onChange={event => setCategoryForm({ ...categoryForm, active: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Aktiv ring
          </label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Förhandsvisning</p>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold" style={{ backgroundColor: categoryForm.fill_color, borderColor: categoryForm.stroke_color, color: categoryForm.text_color }}>
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: categoryForm.stroke_color }} />
              {categoryForm.label || 'Ny ring'}
            </div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
            {editingCategory && (
              <Button variant="ghost" onClick={() => handleDeleteCategory(editingCategory)} className="text-red-600 hover:bg-red-50">
                <Trash2 className="w-4 h-4" /> Ta bort
              </Button>
            )}
            <Button variant="secondary" onClick={() => setShowCategoryModal(false)} className="flex-1">Avbryt</Button>
            <Button onClick={handleSaveCategory} loading={savingCategory} className="flex-1">Spara ring</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PlanningItemRow({ item, onEdit, onDelete, onStatus, typeLabel }: {
  item: PlanningItem;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (status: PlanningItemStatus) => void;
  typeLabel: string;
}) {
  const responsibleName = item.responsible?.name || 'Ej tilldelad';
  const start = new Date(item.start_at);
  const timeLabel = start.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-800 break-words">{item.title}</p>
            <Badge className={statusClasses[item.status]}>{statusLabels[item.status]}</Badge>
            <Badge className={priorityClasses[item.priority]}>{priorityLabels[item.priority]}</Badge>
          </div>
          {item.description && <p className="mt-1 text-sm text-slate-600 break-words">{item.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3.5 h-3.5" /> {formatDate(localDateKey(start))}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock3 className="w-3.5 h-3.5" /> {timeLabel}
            </span>
            <span>{typeLabel}</span>
            <span>Ansvarig: {responsibleName}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:flex-shrink-0">
          {item.status !== 'done' && (
            <Button variant="outline" size="sm" onClick={() => onStatus('done')}>
              <CheckCircle2 className="w-4 h-4" /> Klar
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="w-4 h-4" /> Redigera
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="text-red-600 hover:bg-red-50">
            <Trash2 className="w-4 h-4" /> Ta bort
          </Button>
        </div>
      </div>
    </div>
  );
}

function YearWheelView({ items, allItems, selectedYear, selectedMonth, visibleTypes, typeCounts, categories, categoryByKey, onToggleType, onShowAllTypes, onHideAllTypes, onEditCategory, onCreateCategory, onEdit, onCreate, canManageCategories }: {
  items: PlanningItem[];
  allItems: PlanningItem[];
  selectedYear: number;
  selectedMonth: number | 'all';
  visibleTypes: PlanningItemType[];
  typeCounts: Record<PlanningItemType, number>;
  categories: PlanningCategory[];
  categoryByKey: Record<string, PlanningCategory>;
  onToggleType: (type: PlanningItemType) => void;
  onShowAllTypes: () => void;
  onHideAllTypes: () => void;
  onEditCategory: (category: PlanningCategory) => void;
  onCreateCategory: () => void;
  onEdit: (item: PlanningItem) => void;
  onCreate: (monthIndex?: number) => void;
  canManageCategories: boolean;
}) {
  const activeStatusCount = allItems.filter(item => !['done', 'cancelled'].includes(item.status)).length;
  const doneStatusCount = allItems.filter(item => item.status === 'done').length;
  const cancelledStatusCount = allItems.filter(item => item.status === 'cancelled').length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[19rem_minmax(0,1fr)] gap-4">
      <Card className="p-4 h-fit xl:sticky xl:top-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Årshjul</h2>
            <p className="text-xs text-slate-500">Filtrera ringar och aktiviteter.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onCreate(typeof selectedMonth === 'number' ? selectedMonth : undefined)}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Ringar</h3>
            <span className="text-xs text-slate-400">{visibleTypes.length}/{categories.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {categories.map(category => {
              const type = category.category_key;
              const style = categoryStyle(category);
              const active = visibleTypes.includes(type);
              return (
                <div
                  key={type}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                    active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-50'
                  }`}
                >
                  <button type="button" onClick={() => onToggleType(type)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: style.fill, borderColor: style.stroke }} />
                      <span className="text-sm font-medium text-slate-700 truncate">{style.label}</span>
                    </span>
                  </button>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">{typeCounts[type] || 0}</span>
                  {canManageCategories && (
                    <button type="button" onClick={() => onEditCategory(category)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Redigera ${category.label}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={onShowAllTypes} className="font-semibold text-slate-700 hover:text-blue-700">Visa alla</button>
            <span className="text-slate-300">|</span>
            <button type="button" onClick={onHideAllTypes} className="font-semibold text-slate-500 hover:text-blue-700">Ingen</button>
            {canManageCategories && (
              <>
                <span className="text-slate-300">|</span>
                <button type="button" onClick={onCreateCategory} className="font-semibold text-blue-700 hover:text-blue-800">Ny ring</button>
              </>
            )}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Status</h3>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-600"><span className="h-3 w-3 rounded-full bg-blue-500" /> Aktiva</span>
              <span className="font-semibold text-slate-700">{activeStatusCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-600"><span className="h-3 w-3 rounded-full bg-green-500" /> Klara</span>
              <span className="font-semibold text-slate-700">{doneStatusCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-slate-600"><span className="h-3 w-3 rounded-full bg-slate-400" /> Avbrutna</span>
              <span className="font-semibold text-slate-700">{cancelledStatusCount}</span>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="min-h-[34rem] bg-slate-50 p-2 sm:p-4">
          <div className="mx-auto w-full max-w-[58rem]">
            <YearWheelSvg
              items={items}
              selectedYear={selectedYear}
              visibleTypes={visibleTypes}
              categoryByKey={categoryByKey}
              onEdit={onEdit}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

function YearWheelSvg({ items, selectedYear, visibleTypes, categoryByKey, onEdit }: {
  items: PlanningItem[];
  selectedYear: number;
  visibleTypes: PlanningItemType[];
  categoryByKey: Record<string, PlanningCategory>;
  onEdit: (item: PlanningItem) => void;
}) {
  const [activeTooltip, setActiveTooltip] = useState<{
    item: PlanningItem;
    x: number;
    y: number;
    dateLabel: string;
  } | null>(null);
  const size = 920;
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = 420;
  const monthRingInner = 392;
  const monthRingOuter = 426;
  const weekRingInner = 358;
  const weekRingOuter = 392;
  const activityOuterStart = 334;
  const ringWidth = 38;
  const ringGap = 8;
  const centerRadius = Math.max(118, activityOuterStart - (visibleTypes.length * (ringWidth + ringGap)) - 16);
  const itemOffsets = new Map<string, number>();

  const visibleTypeSet = new Set(visibleTypes);
  const visibleItems = items.filter(item => visibleTypeSet.has(item.item_type));

  const typeRing = (type: PlanningItemType) => {
    const index = visibleTypes.indexOf(type);
    const outer = activityOuterStart - index * (ringWidth + ringGap);
    return { outer, inner: outer - ringWidth };
  };

  const activityColor = (item: PlanningItem) => {
    if (item.status === 'done') return '#22c55e';
    if (item.status === 'cancelled') return '#94a3b8';
    if (item.priority === 'urgent') return '#ef4444';
    if (item.status === 'in_progress') return '#3b82f6';
    return categoryStyle(categoryByKey[item.item_type]).stroke;
  };

  const showTooltip = (item: PlanningItem, x: number, y: number, dateLabel: string) => {
    setActiveTooltip({ item, x, y, dateLabel });
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Årshjul ${selectedYear}`}
        onClick={() => setActiveTooltip(null)}
      >
        <rect width={size} height={size} fill="#f8fafc" />

        {Array.from({ length: 12 }, (_, monthIndex) => {
          const { startAngle, endAngle } = monthAngleRange(selectedYear, monthIndex);
          const midAngle = (startAngle + endAngle) / 2;
          const labelPoint = polarToCartesian(cx, cy, 442, midAngle);
          return (
            <g key={`month-${monthIndex}`}>
              <path
                d={describeArc(cx, cy, monthRingInner, monthRingOuter, startAngle, endAngle - 0.6)}
                fill={monthIndex % 2 === 0 ? '#ffffff' : '#f1f5f9'}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-600 text-[13px] font-semibold capitalize"
                transform={`rotate(${rotationForText(midAngle)} ${labelPoint.x} ${labelPoint.y})`}
              >
                {monthName(selectedYear, monthIndex)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: 52 }, (_, weekIndex) => {
          const startDay = Math.floor((weekIndex / 52) * daysInYear(selectedYear));
          const endDay = Math.floor(((weekIndex + 1) / 52) * daysInYear(selectedYear));
          const startDate = new Date(selectedYear, 0, startDay + 1);
          const endDate = new Date(selectedYear, 0, Math.max(startDay + 2, endDay + 1));
          const startAngle = angleForDate(startDate, selectedYear);
          const endAngle = angleForDate(endDate, selectedYear);
          const midAngle = (startAngle + endAngle) / 2;
          const lineOuter = polarToCartesian(cx, cy, weekRingOuter, startAngle);
          const lineInner = polarToCartesian(cx, cy, weekRingInner, startAngle);
          const showLabel = weekIndex % 2 === 0;
          const labelPoint = polarToCartesian(cx, cy, 374, midAngle);
          const weekStart = new Date(selectedYear, 0, startDay + 1);
          const weekEnd = new Date(selectedYear, 0, Math.min(daysInYear(selectedYear), endDay + 1));
          const label = `${weekStart.getDate()}-${weekEnd.getDate()}`;
          return (
            <g key={`week-${weekIndex}`}>
              <path
                d={describeArc(cx, cy, weekRingInner, weekRingOuter, startAngle, endAngle - 0.2)}
                fill="#fff"
                stroke="#e5e7eb"
                strokeWidth={0.8}
              />
              <line x1={lineInner.x} y1={lineInner.y} x2={lineOuter.x} y2={lineOuter.y} stroke="#e2e8f0" strokeWidth={0.7} />
              {showLabel && (
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-slate-400 text-[9px] font-medium"
                  transform={`rotate(${rotationForText(midAngle)} ${labelPoint.x} ${labelPoint.y})`}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {visibleTypes.map(type => {
          const ring = typeRing(type);
          const style = categoryStyle(categoryByKey[type]);
          return (
            <g key={`ring-${type}`}>
              <circle cx={cx} cy={cy} r={(ring.inner + ring.outer) / 2} fill="none" stroke={style.fill} strokeWidth={ringWidth} opacity={0.78} />
              <circle cx={cx} cy={cy} r={ring.outer} fill="none" stroke="#ffffff" strokeWidth={2} />
              <circle cx={cx} cy={cy} r={ring.inner} fill="none" stroke="#ffffff" strokeWidth={2} />
              {Array.from({ length: 12 }, (_, monthIndex) => {
                const { startAngle: angle } = monthAngleRange(selectedYear, monthIndex);
                const inner = polarToCartesian(cx, cy, ring.inner, angle);
                const outer = polarToCartesian(cx, cy, ring.outer, angle);
                return <line key={`${type}-${monthIndex}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="#ffffff" strokeWidth={1.5} opacity={0.8} />;
              })}
              <text
                x={cx}
                y={cy - ((ring.inner + ring.outer) / 2)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="text-[11px] font-bold"
                fill={style.text}
              >
                {style.label}
              </text>
            </g>
          );
        })}

        {visibleItems.map(item => {
          const ring = typeRing(item.item_type);
          const itemDate = new Date(item.start_at);
          const baseAngle = angleForDate(itemDate, selectedYear);
          const bucket = `${item.item_type}-${Math.round(baseAngle / 5)}`;
          const offset = itemOffsets.get(bucket) || 0;
          itemOffsets.set(bucket, offset + 1);
          const angle = baseAngle + offset * 2.2;
          const startAngle = angle - 1.6;
          const endAngle = angle + Math.max(4, Math.min(18, item.end_at ? Math.abs(angleForDate(new Date(item.end_at), selectedYear) - baseAngle) : 7));
          const itemPath = describeArc(cx, cy, ring.inner + 4, ring.outer - 4, startAngle, endAngle);
          const labelRadius = (ring.inner + ring.outer) / 2;
          const labelPoint = polarToCartesian(cx, cy, labelRadius, (startAngle + endAngle) / 2);
          const labelAngle = (startAngle + endAngle) / 2;
          const arcLength = (Math.PI / 180) * Math.max(4, endAngle - startAngle) * labelRadius;
          const maxLabelLength = Math.max(3, Math.min(12, Math.floor(arcLength / 9)));
          const label = truncateLabel(item.title, maxLabelLength);
          const dateLabel = formatDate(localDateKey(itemDate));
          return (
            <g
              key={item.id}
              className="cursor-pointer outline-none"
              role="button"
              tabIndex={0}
              aria-label={`${item.title}, ${dateLabel}`}
              onMouseEnter={() => showTooltip(item, labelPoint.x, labelPoint.y, dateLabel)}
              onFocus={() => showTooltip(item, labelPoint.x, labelPoint.y, dateLabel)}
              onClick={event => {
                event.stopPropagation();
                showTooltip(item, labelPoint.x, labelPoint.y, dateLabel);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  showTooltip(item, labelPoint.x, labelPoint.y, dateLabel);
                }
              }}
            >
              <path d={itemPath} fill={activityColor(item)} opacity={0.88}>
                <title>{`${item.title} - ${dateLabel}`}</title>
              </path>
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="pointer-events-none select-none fill-white text-[9px] font-bold"
                transform={`rotate(${rotationForText(labelAngle)} ${labelPoint.x} ${labelPoint.y})`}
              >
                {label}
              </text>
            </g>
          );
        })}

        <circle cx={cx} cy={cy} r={centerRadius} fill="#ffffff" stroke="#e2e8f0" strokeWidth={3} />
        <text x={cx} y={cy - 12} textAnchor="middle" className="fill-slate-800 text-[30px] font-bold">{selectedYear}</text>
        <text x={cx} y={cy + 18} textAnchor="middle" className="fill-slate-500 text-[13px] font-medium">
          {visibleItems.length} planeringspunkter
        </text>
      </svg>

      {visibleItems.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-lg border border-slate-200 bg-white/95 px-4 py-3 text-center shadow-sm">
            <p className="text-sm font-semibold text-slate-700">Inga punkter i urvalet</p>
            <p className="text-xs text-slate-500">Ändra filter eller lägg till en planeringspunkt.</p>
          </div>
        </div>
      )}

      {activeTooltip && (
        <div
          className="absolute z-10 w-56 max-w-[calc(100%-1rem)] rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg"
          style={{
            left: `${Math.min(88, Math.max(12, (activeTooltip.x / size) * 100))}%`,
            top: `${Math.min(88, Math.max(12, (activeTooltip.y / size) * 100))}%`,
            transform: 'translate(-50%, -110%)',
          }}
          onClick={event => event.stopPropagation()}
        >
          <p className="break-words text-sm font-bold text-slate-900">{activeTooltip.item.title}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge className={statusClasses[activeTooltip.item.status]}>{statusLabels[activeTooltip.item.status]}</Badge>
            <Badge className={priorityClasses[activeTooltip.item.priority]}>{priorityLabels[activeTooltip.item.priority]}</Badge>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {categoryStyle(categoryByKey[activeTooltip.item.item_type]).label} · {activeTooltip.dateLabel}
          </p>
          {activeTooltip.item.description && (
            <p className="mt-2 line-clamp-3 break-words text-xs text-slate-600">{activeTooltip.item.description}</p>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => onEdit(activeTooltip.item)}>
              Redigera
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setActiveTooltip(null)}>
              Stäng
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
