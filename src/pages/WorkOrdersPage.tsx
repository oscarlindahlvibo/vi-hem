import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Textarea,
  Select,
  SearchInput,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import {
  formatDate,
  formatDateTime,
  WO_STATUS_LABELS,
  getWOStatusColor,
  getWOPriorityColor,
  WO_PRIORITY_LABELS,
  WO_CATEGORIES,
  formatMinutes,
} from '../lib/utils';
import type {
  WorkOrder,
  WorkOrderComment,
  WOStatus,
  WOPriority,
  Profile,
  Property,
  Apartment,
  AttachmentItem,
} from '../types';
import {
  Plus,
  Archive,
  ClipboardList,
  Filter,
  LayoutGrid,
  List,
  Calendar,
  User,
  Building2,
  ChevronRight,
  Clock,
  Play,
  Square,
  Paperclip,
  CheckSquare,
  X,
} from 'lucide-react';
import { TIME_CATEGORY_LABELS } from '../lib/utils';
import type { TimeCategory } from '../types';

type FilterView = 'all' | 'mine' | 'new' | 'urgent';
type WorkOrderListTab = 'active' | 'archived';

type WorkOrderPerson = Pick<Profile, 'name'>;

interface WOWithRelations extends Omit<WorkOrder, 'property' | 'apartment' | 'tenant' | 'assigned' | 'creator'> {
  property?: Pick<Property, 'name' | 'address'>;
  apartment?: { apartment_number: string };
  tenant?: WorkOrderPerson;
  assigned?: WorkOrderPerson;
  creator?: WorkOrderPerson;
}

type CreateWorkOrderForm = {
  title: string;
  description: string;
  category: string;
  priority: WOPriority;
  status: WOStatus;
  property_id: string;
  apartment_id: string;
  tenant_id: string;
  due_date: string;
  assigned_to_ids: string[];
  checklist: string[];
  files: File[];
};

const defaultCreateForm: CreateWorkOrderForm = {
  title: '',
  description: '',
  category: WO_CATEGORIES[0],
  priority: 'normal',
  status: 'new',
  property_id: '',
  apartment_id: '',
  tenant_id: '',
  due_date: '',
  assigned_to_ids: [],
  checklist: [''],
  files: [],
};

const WO_STATUSES: WOStatus[] = [
  'new',
  'assigned',
  'started',
  'paused',
  'waiting_material',
  'waiting_tenant',
  'waiting_contractor',
  'ready_for_check',
  'completed',
  'cancelled',
];

const ARCHIVED_WO_STATUSES: WOStatus[] = ['completed', 'cancelled'];

export function WorkOrdersPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  const [workOrders, setWorkOrders] = useState<WOWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<WOStatus | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<WOPriority | 'all'>('all');
  const [filterView, setFilterView] = useState<FilterView>('all');
  const [listTab, setListTab] = useState<WorkOrderListTab>('active');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WOWithRelations | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [tenants, setTenants] = useState<Profile[]>([]);
  const [staffMembers, setStaffMembers] = useState<Profile[]>([]);
  const [comments, setComments] = useState<WorkOrderComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [totalTimeLogged, setTotalTimeLogged] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Create form state
  const [createForm, setCreateForm] = useState<CreateWorkOrderForm>(defaultCreateForm);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState('');

  // Detail modal state
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newDetailStatus, setNewDetailStatus] = useState<WOStatus>('new');
  const [updatingAssignment, setUpdatingAssignment] = useState(false);
  const [newAssignedToIds, setNewAssignedToIds] = useState<string[]>([]);

  // Stamp-in state (inline, tied to work order detail)
  const [showStampInModal, setShowStampInModal] = useState(false);
  const [stampCategory, setStampCategory] = useState<TimeCategory>('work_order');
  const [stampComment, setStampComment] = useState('');
  const [stampingIn, setStampingIn] = useState(false);
  const [activeTimeEntry, setActiveTimeEntry] = useState<{ id: string; work_order_id: string | null } | null>(null);

  const isStaff = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';

  // Fetch work orders
  useEffect(() => {
    if (!authLoading && user) {
      fetchWorkOrders();
      if (isStaff) {
        fetchProperties();
        fetchApartments();
        fetchTenants();
        fetchStaffMembers();
      }
    }
  }, [authLoading, user, isStaff]);

  // Fetch comments when detail modal opens
  useEffect(() => {
    if (showDetailModal && selectedWorkOrder) {
      fetchComments();
      fetchTimeLogged();
      if (isStaff) checkActiveTimeEntry();
    }
  }, [showDetailModal, selectedWorkOrder?.id]);

  async function fetchWorkOrders() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('work_orders')
        .select(
          `*,
          property:properties(name,address),
          apartment:apartments(apartment_number),
          tenant:profiles!work_orders_tenant_id_fkey(name),
          assigned:profiles!work_orders_assigned_to_fkey(name),
          creator:profiles!work_orders_created_by_fkey(name)`
        )
        .order('created_at', { ascending: false });

      if (error) throw error;
      setWorkOrders((data || []) as unknown as WOWithRelations[]);
    } catch (err) {
      console.error('Error fetching work orders:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchProperties() {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('*')
        .eq('active', true)
        .order('name');

      if (error) throw error;
      setProperties(data || []);
    } catch (err) {
      console.error('Error fetching properties:', err);
    }
  }

  async function fetchStaffMembers() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['staff', 'admin'])
        .eq('active', true)
        .order('name');

      if (error) throw error;
      setStaffMembers(data || []);
    } catch (err) {
      console.error('Error fetching staff:', err);
    }
  }

  async function fetchApartments() {
    try {
      const { data, error } = await supabase
        .from('apartments')
        .select('*')
        .order('apartment_number');

      if (error) throw error;
      setApartments(data || []);
    } catch (err) {
      console.error('Error fetching apartments:', err);
    }
  }

  async function fetchTenants() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'tenant')
        .eq('active', true)
        .order('name');

      if (error) throw error;
      setTenants(data || []);
    } catch (err) {
      console.error('Error fetching tenants:', err);
    }
  }

  async function fetchComments() {
    if (!selectedWorkOrder) return;
    try {
      setLoadingComments(true);
      const { data, error } = await supabase
        .from('work_order_comments')
        .select('*, user:profiles(name)')
        .eq('work_order_id', selectedWorkOrder.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setComments(data || []);
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  }

  async function fetchTimeLogged() {
    if (!selectedWorkOrder) return;
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select('total_minutes')
        .eq('work_order_id', selectedWorkOrder.id);

      if (error) throw error;
      const total = (data || []).reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
      setTotalTimeLogged(total);
    } catch (err) {
      console.error('Error fetching time logged:', err);
    }
  }

  async function createWorkOrder() {
    if (!user || !createForm.title) return;

    try {
      setSubmittingCreate(true);
      setCreateError('');
      const workOrderId = crypto.randomUUID();
      const attachments = await uploadWorkOrderFiles(workOrderId, createForm.files, user.id);
      const checklist = createForm.checklist
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ id: crypto.randomUUID(), text, done: false }));
      const assignedIds = createForm.assigned_to_ids;
      const { error } = await supabase.from('work_orders').insert([
        {
          id: workOrderId,
          title: createForm.title,
          description: createForm.description,
          category: createForm.category,
          priority: createForm.priority,
          status: createForm.status,
          property_id: createForm.property_id || null,
          apartment_id: createForm.apartment_id || null,
          tenant_id: createForm.tenant_id || null,
          due_date: createForm.due_date || null,
          assigned_to: assignedIds[0] || null,
          assigned_to_ids: assignedIds,
          checklist,
          attachments,
          created_by: user.id,
          organisation_id: user.organisation_id || null,
        },
      ]);

      if (error) throw error;
      setCreateForm(defaultCreateForm);
      setShowCreateModal(false);
      await fetchWorkOrders();
    } catch (err: any) {
      console.error('Error creating work order:', err);
      setCreateError(err.message || 'Kunde inte skapa arbetsordern. Kontrollera fälten och försök igen.');
    } finally {
      setSubmittingCreate(false);
    }
  }

  async function uploadWorkOrderFiles(workOrderId: string, files: File[], userId: string): Promise<AttachmentItem[]> {
    if (files.length === 0) return [];

    const uploaded: AttachmentItem[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `work-orders/${workOrderId}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await supabase.storage
        .from('work-order-attachments')
        .upload(path, file, { upsert: false });

      if (error) {
        throw new Error(`Kunde inte ladda upp ${file.name}: ${error.message}`);
      }

      const { data } = supabase.storage.from('work-order-attachments').getPublicUrl(path);
      uploaded.push({
        id: crypto.randomUUID(),
        name: file.name,
        url: data.publicUrl,
        path,
        type: file.type,
        size: file.size,
        uploaded_at: new Date().toISOString(),
        uploaded_by: userId,
      });
    }
    return uploaded;
  }

  async function addComment() {
    if (!user || !selectedWorkOrder || !commentText.trim()) return;

    try {
      setPostingComment(true);
      const { error } = await supabase.from('work_order_comments').insert([
        {
          work_order_id: selectedWorkOrder.id,
          user_id: user.id,
          comment: commentText,
          internal: commentInternal,
        },
      ]);

      if (error) throw error;
      setCommentText('');
      setCommentInternal(false);
      await fetchComments();
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
      setPostingComment(false);
    }
  }

  async function updateWorkOrderStatus() {
    if (!selectedWorkOrder || !newDetailStatus) return;

    try {
      setUpdatingStatus(true);
      const { error } = await supabase
        .from('work_orders')
        .update({ status: newDetailStatus })
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;
      setSelectedWorkOrder({ ...selectedWorkOrder, status: newDetailStatus });
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating status:', err);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function updateWorkOrderAssignment() {
    if (!selectedWorkOrder) return;

    try {
      setUpdatingAssignment(true);
      const assignedIds = newAssignedToIds;
      const { error } = await supabase
        .from('work_orders')
        .update({ assigned_to: assignedIds[0] || null, assigned_to_ids: assignedIds })
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;
      setSelectedWorkOrder({ ...selectedWorkOrder, assigned_to: assignedIds[0] || null, assigned_to_ids: assignedIds });
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating assignment:', err);
    } finally {
      setUpdatingAssignment(false);
    }
  }

  async function checkActiveTimeEntry() {
    if (!user) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('time_entries')
      .select('id, work_order_id')
      .eq('user_id', user.id)
      .eq('status', 'draft')
      .gte('start_time', today.toISOString())
      .is('end_time', null)
      .order('start_time', { ascending: false })
      .limit(1);
    setActiveTimeEntry(data?.[0] || null);
  }

  async function handleStampIn() {
    if (!user || !selectedWorkOrder) return;
    try {
      setStampingIn(true);
      const { error } = await supabase.from('time_entries').insert({
        user_id: user.id,
        organisation_id: user.organisation_id || null,
        work_order_id: selectedWorkOrder.id,
        category: stampCategory,
        start_time: new Date().toISOString(),
        end_time: null,
        break_minutes: 0,
        total_minutes: 0,
        comment: stampComment || '',
        status: 'draft',
      });
      if (error) throw error;
      setShowStampInModal(false);
      setStampComment('');
      await checkActiveTimeEntry();
      await fetchTimeLogged();
    } catch (err) {
      console.error('Failed to stamp in:', err);
    } finally {
      setStampingIn(false);
    }
  }

  async function handleStampOut() {
    if (!activeTimeEntry) return;
    try {
      setStampingIn(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: openEntries } = await supabase
        .from('time_entries')
        .select('id, start_time, break_minutes, entry_type')
        .eq('user_id', user.id)
        .eq('status', 'draft')
        .gte('start_time', today.toISOString())
        .is('end_time', null);
      const endTime = new Date().toISOString();
      await Promise.all((openEntries || []).map(async entry => {
        const breakMinutes = entry.entry_type === 'break' ? 0 : entry.break_minutes || 0;
        const totalMinutes = Math.max(
          Math.floor((Date.now() - new Date(entry.start_time).getTime()) / 60000) - breakMinutes,
          0
        );
        await supabase
          .from('time_entries')
          .update({ end_time: endTime, total_minutes: totalMinutes, status: 'submitted' })
          .eq('id', entry.id);
      }));
      setActiveTimeEntry(null);
      await checkActiveTimeEntry();
      await fetchTimeLogged();
    } catch (err) {
      console.error('Failed to stamp out:', err);
    } finally {
      setStampingIn(false);
    }
  }

  function filteredWorkOrders() {
    return workOrders.filter((wo) => {
      const isArchived = ARCHIVED_WO_STATUSES.includes(wo.status);
      const matchesTab = listTab === 'archived' ? isArchived : !isArchived;
      const matchesSearch = wo.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === 'all' || wo.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || wo.priority === filterPriority;

      let matchesView = true;
      if (filterView === 'mine') {
        matchesView = wo.assigned_to === user?.id || wo.assigned_to_ids?.includes(user?.id || '');
      } else if (filterView === 'new') {
        matchesView = wo.status === 'new';
      } else if (filterView === 'urgent') {
        matchesView = wo.priority === 'urgent' || wo.priority === 'high';
      }

      return matchesTab && matchesSearch && matchesStatus && matchesPriority && matchesView;
    });
  }

  function workOrdersByStatus() {
    const grouped: Record<WOStatus, WOWithRelations[]> = {
      new: [],
      assigned: [],
      started: [],
      paused: [],
      waiting_material: [],
      waiting_tenant: [],
      waiting_contractor: [],
      ready_for_check: [],
      completed: [],
      cancelled: [],
    };

    filteredWorkOrders().forEach((wo) => {
      grouped[wo.status].push(wo);
    });

    return grouped;
  }

  if (authLoading) return <LoadingPage />;

  const filtered = filteredWorkOrders();
  const propertyApartments = createForm.property_id
    ? apartments.filter((apt) => apt.property_id === createForm.property_id)
    : apartments;
  const assigneeName = (id: string) => staffMembers.find((staff) => staff.id === id)?.name || 'Okänd';
  const assigneeNames = (wo: WOWithRelations) => {
    const ids = wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : [];
    if (ids.length === 0) return wo.assigned?.name || 'Ej tilldelad';
    return ids.map(assigneeName).join(', ');
  };
  const toggleCreateAssignee = (staffId: string) => {
    setCreateForm((current) => ({
      ...current,
      assigned_to_ids: current.assigned_to_ids.includes(staffId)
        ? current.assigned_to_ids.filter((id) => id !== staffId)
        : [...current.assigned_to_ids, staffId],
    }));
  };
  const toggleDetailAssignee = (staffId: string) => {
    setNewAssignedToIds((current) => current.includes(staffId)
      ? current.filter((id) => id !== staffId)
      : [...current, staffId]);
  };
  const updateChecklistItem = (index: number, value: string) => {
    setCreateForm((current) => ({
      ...current,
      checklist: current.checklist.map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  };
  const removeChecklistItem = (index: number) => {
    setCreateForm((current) => ({
      ...current,
      checklist: current.checklist.filter((_, itemIndex) => itemIndex !== index),
    }));
  };
  const activeCount = workOrders.filter((wo) => !ARCHIVED_WO_STATUSES.includes(wo.status)).length;
  const archivedCount = workOrders.filter((wo) => ARCHIVED_WO_STATUSES.includes(wo.status)).length;
  const statusFilterOptions = WO_STATUSES
    .filter((status) => listTab === 'archived'
      ? ARCHIVED_WO_STATUSES.includes(status)
      : !ARCHIVED_WO_STATUSES.includes(status))
    .map((s) => ({ value: s, label: WO_STATUS_LABELS[s] }));
  const visibleStatuses = WO_STATUSES.filter((status) => listTab === 'archived'
    ? ARCHIVED_WO_STATUSES.includes(status)
    : !ARCHIVED_WO_STATUSES.includes(status));
  const statusGroups: Record<WOStatus, WOWithRelations[]> = viewMode === 'kanban'
    ? workOrdersByStatus()
    : {
        new: [],
        assigned: [],
        started: [],
        paused: [],
        waiting_material: [],
        waiting_tenant: [],
        waiting_contractor: [],
        ready_for_check: [],
        completed: [],
        cancelled: [],
      };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Arbetsordrar"
        subtitle={`${filtered.length} arbetsordrar`}
        action={
          isStaff ? (
            <Button onClick={() => setShowCreateModal(true)} size="sm">
              <Plus className="w-4 h-4" />
              Ny arbetsorder
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => {
            setListTab('active');
            setFilterStatus('all');
            setFilterView('all');
          }}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            listTab === 'active' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Aktiva
          <span className={listTab === 'active' ? 'text-blue-100' : 'text-slate-400'}>{activeCount}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setListTab('archived');
            setFilterStatus('all');
            setFilterView('all');
          }}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            listTab === 'archived' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          <Archive className="w-4 h-4" />
          Arkiverade
          <span className={listTab === 'archived' ? 'text-blue-100' : 'text-slate-400'}>{archivedCount}</span>
        </button>
      </div>

      {/* Filter bar */}
      <div className="space-y-3 md:space-y-0 md:flex md:items-center md:gap-3 flex-wrap">
        <SearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Sök arbetsordrar..."
          className="flex-1 md:min-w-[200px]"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors md:hidden"
          >
            <Filter className="w-4 h-4 text-slate-600" />
          </button>

          <Select
            options={[
              { value: 'all', label: 'Alla statusar' },
              ...statusFilterOptions,
            ]}
            value={filterStatus}
            onChange={(e) => setFilterStatus((e.target.value as any) || 'all')}
            className="hidden md:block"
          />

          <Select
            options={[
              { value: 'all', label: 'Alla prioriteter' },
              { value: 'low', label: WO_PRIORITY_LABELS.low },
              { value: 'normal', label: WO_PRIORITY_LABELS.normal },
              { value: 'high', label: WO_PRIORITY_LABELS.high },
              { value: 'urgent', label: WO_PRIORITY_LABELS.urgent },
            ]}
            value={filterPriority}
            onChange={(e) => setFilterPriority((e.target.value as any) || 'all')}
            className="hidden md:block"
          />

          <Select
            options={[
              { value: 'all', label: 'Alla arbetsordrar' },
              { value: 'mine', label: 'Tilldelade till mig' },
              { value: 'new', label: 'Nya arbetsordrar' },
              { value: 'urgent', label: 'Akuta arbetsordrar' },
            ]}
            value={filterView}
            onChange={(e) => setFilterView((e.target.value as any) || 'all')}
            className="hidden md:block"
          />

          <div className="hidden md:flex items-center gap-1 border border-slate-300 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-2 rounded transition-colors ${
                viewMode === 'kanban' ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-100'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile filters */}
      {showFilters && (
        <Card className="p-4 md:hidden space-y-3">
          <Select
            label="Status"
            options={[
              { value: 'all', label: 'Alla statusar' },
              ...statusFilterOptions,
            ]}
            value={filterStatus}
            onChange={(e) => setFilterStatus((e.target.value as any) || 'all')}
          />

          <Select
            label="Prioritet"
            options={[
              { value: 'all', label: 'Alla prioriteter' },
              { value: 'low', label: WO_PRIORITY_LABELS.low },
              { value: 'normal', label: WO_PRIORITY_LABELS.normal },
              { value: 'high', label: WO_PRIORITY_LABELS.high },
              { value: 'urgent', label: WO_PRIORITY_LABELS.urgent },
            ]}
            value={filterPriority}
            onChange={(e) => setFilterPriority((e.target.value as any) || 'all')}
          />

          <Select
            label="Visning"
            options={[
              { value: 'all', label: 'Alla arbetsordrar' },
              { value: 'mine', label: 'Tilldelade till mig' },
              { value: 'new', label: 'Nya arbetsordrar' },
              { value: 'urgent', label: 'Akuta arbetsordrar' },
            ]}
            value={filterView}
            onChange={(e) => setFilterView((e.target.value as any) || 'all')}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setViewMode('list');
                setShowFilters(false);
              }}
              className={`flex-1 p-2 rounded border transition-colors ${
                viewMode === 'list' ? 'bg-blue-100 border-blue-300' : 'border-slate-300'
              }`}
            >
              <List className="w-4 h-4 inline mr-1" />
              Lista
            </button>
            <button
              onClick={() => {
                setViewMode('kanban');
                setShowFilters(false);
              }}
              className={`flex-1 p-2 rounded border transition-colors ${
                viewMode === 'kanban' ? 'bg-blue-100 border-blue-300' : 'border-slate-300'
              }`}
            >
              <LayoutGrid className="w-4 h-4 inline mr-1" />
              Kanban
            </button>
          </div>
        </Card>
      )}

      {/* Content */}
      {loading ? (
        <LoadingPage />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-12 h-12" />}
          title="Inga arbetsordrar"
          description={
            listTab === 'archived'
              ? 'Det finns inga arkiverade arbetsordrar som matchar dina filter.'
              : 'Det finns inga aktiva arbetsordrar som matchar dina filter.'
          }
          action={
            isStaff && listTab === 'active' ? (
              <Button onClick={() => setShowCreateModal(true)} variant="primary" size="sm">
                <Plus className="w-4 h-4" />
                Skapa arbetsorder
              </Button>
            ) : null
          }
        />
      ) : viewMode === 'list' ? (
        <>
          <div className="grid gap-3 md:hidden">
            {filtered.map((wo) => (
              <Card
                key={wo.id}
                className="p-4 cursor-pointer hover:shadow-md transition-all"
                onClick={() => {
                  setSelectedWorkOrder(wo);
                  setNewDetailStatus(wo.status);
                  setNewAssignedToIds(wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []);
                  setShowDetailModal(true);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 leading-snug break-words">{wo.title}</h3>
                    <p className="mt-1 text-sm text-slate-500 break-words">
                      {wo.property?.name || 'Ingen fastighet'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className={getWOStatusColor(wo.status)}>
                    {WO_STATUS_LABELS[wo.status]}
                  </Badge>
                  <Badge className={getWOPriorityColor(wo.priority)}>
                    {WO_PRIORITY_LABELS[wo.priority]}
                  </Badge>
                </div>

                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  <div className="flex items-center gap-2 min-w-0">
                    <ClipboardList className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{wo.category}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="truncate">{assigneeNames(wo)}</span>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>{wo.due_date ? formatDate(wo.due_date) : 'Inget förfallodatum'}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Titel</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Kategori</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Prioritet</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Fastighet</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Tilldelad</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">Förfallodatum</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-600">Åtgärder</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((wo) => (
                    <tr
                      key={wo.id}
                      className="border-b border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedWorkOrder(wo);
                        setNewDetailStatus(wo.status);
                        setNewAssignedToIds(wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []);
                        setShowDetailModal(true);
                      }}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{wo.title}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{wo.category}</td>
                      <td className="px-4 py-3 text-sm">
                        <Badge className={getWOPriorityColor(wo.priority)}>
                          {WO_PRIORITY_LABELS[wo.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Badge className={getWOStatusColor(wo.status)}>
                          {WO_STATUS_LABELS[wo.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {wo.property?.name || '–'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {assigneeNames(wo)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {wo.due_date ? formatDate(wo.due_date) : '–'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <ChevronRight className="w-4 h-4 text-slate-400 inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <div className="space-y-4">
          <div className="md:overflow-x-auto pb-4">
            <div className="flex flex-col md:flex-row gap-4 md:min-w-max">
              {visibleStatuses.map((status) => (
                <div
                  key={status}
                  className="w-full md:w-80 md:flex-shrink-0 bg-slate-50 rounded-xl border border-slate-200 p-4"
                >
                  <h3 className="font-semibold text-slate-800 mb-3 flex items-center justify-between">
                    {WO_STATUS_LABELS[status]}
                    <Badge className="bg-slate-200 text-slate-700">
                      {statusGroups[status]?.length || 0}
                    </Badge>
                  </h3>

                  <div className="space-y-3">
                    {(statusGroups[status] || []).map((wo) => (
                      <Card
                        key={wo.id}
                        className="p-3 cursor-pointer hover:shadow-md transition-all"
                        onClick={() => {
                          setSelectedWorkOrder(wo);
                          setNewDetailStatus(wo.status);
                          setNewAssignedToIds(wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []);
                          setShowDetailModal(true);
                        }}
                      >
                        <div className="space-y-2">
                          <h4 className="font-medium text-slate-800 text-sm line-clamp-2">
                            {wo.title}
                          </h4>

                          <div className="flex items-center justify-between gap-2">
                            <Badge className={getWOPriorityColor(wo.priority)}>
                              {WO_PRIORITY_LABELS[wo.priority]}
                            </Badge>
                          </div>

                          {(wo.assigned_to_ids?.length || wo.assigned?.name) && (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <User className="w-3 h-3" />
                              {assigneeNames(wo)}
                            </div>
                          )}

                          {wo.due_date && (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <Calendar className="w-3 h-3" />
                              {formatDate(wo.due_date)}
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {isStaff && (
        <Modal
          open={showCreateModal}
          onClose={() => {
            setShowCreateModal(false);
            setCreateError('');
          }}
          title="Ny arbetsorder"
          size="lg"
        >
          <div className="space-y-4">
            {createError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {createError}
              </div>
            )}
            <Input
              label="Titel *"
              required
              value={createForm.title}
              onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
              placeholder="T.ex. Reparera dörr i lägenhet 201"
            />

            <Textarea
              label="Beskrivning"
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              placeholder="Detaljer om arbetet..."
              rows={4}
            />

            <Select
              label="Kategori"
              options={WO_CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
              value={createForm.category}
              onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
            />

            <Select
              label="Prioritet"
              options={[
                { value: 'low', label: WO_PRIORITY_LABELS.low },
                { value: 'normal', label: WO_PRIORITY_LABELS.normal },
                { value: 'high', label: WO_PRIORITY_LABELS.high },
                { value: 'urgent', label: WO_PRIORITY_LABELS.urgent },
              ]}
              value={createForm.priority}
              onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value as WOPriority })}
            />

            <Select
              label="Status"
              options={WO_STATUSES.map((s) => ({ value: s, label: WO_STATUS_LABELS[s] }))}
              value={createForm.status}
              onChange={(e) => setCreateForm({ ...createForm, status: e.target.value as WOStatus })}
            />

            <Select
              label="Fastighet"
              options={[{ value: '', label: '- Ingen -' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
              value={createForm.property_id}
              onChange={(e) => setCreateForm({ ...createForm, property_id: e.target.value, apartment_id: '' })}
            />

            <Select
              label="Lägenhet"
              options={[
                { value: '', label: '- Ingen -' },
                ...propertyApartments.map((apt) => ({
                  value: apt.id,
                  label: `${apt.apartment_number}${apt.property?.name ? ` · ${apt.property.name}` : ''}`,
                })),
              ]}
              value={createForm.apartment_id}
              onChange={(e) => setCreateForm({ ...createForm, apartment_id: e.target.value })}
            />

            <Select
              label="Hyresgäst"
              options={[{ value: '', label: '- Ingen -' }, ...tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]}
              value={createForm.tenant_id}
              onChange={(e) => setCreateForm({ ...createForm, tenant_id: e.target.value })}
            />

            <Input
              label="Förfallodatum"
              type="date"
              value={createForm.due_date}
              onChange={(e) => setCreateForm({ ...createForm, due_date: e.target.value })}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Tilldela till</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {staffMembers.map((staff) => (
                  <label key={staff.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={createForm.assigned_to_ids.includes(staff.id)}
                      onChange={() => toggleCreateAssignee(staff.id)}
                      className="rounded border-slate-300 accent-blue-600"
                    />
                    <span>{staff.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">Första valda person blir primärt ansvarig, men alla valda visas som tilldelade.</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">Checklista</p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCreateForm({ ...createForm, checklist: [...createForm.checklist, ''] })}
                >
                  <Plus className="w-3.5 h-3.5" /> Lägg till rad
                </Button>
              </div>
              <div className="space-y-2">
                {createForm.checklist.map((item, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={item}
                      onChange={(event) => updateChecklistItem(index, event.target.value)}
                      placeholder="Ex. Kontrollera lås, dokumentera före/efter..."
                    />
                    {createForm.checklist.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeChecklistItem(index)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Bilder/filer</p>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600 hover:bg-slate-100">
                <Paperclip className="mb-2 h-5 w-5 text-slate-400" />
                Välj bilder eller filer att bifoga
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => setCreateForm({ ...createForm, files: Array.from(event.target.files || []) })}
                />
              </label>
              {createForm.files.length > 0 && (
                <div className="space-y-1">
                  {createForm.files.map((file) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <Paperclip className="h-3.5 w-3.5" />
                      <span className="truncate">{file.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreateModal(false);
                  setCreateError('');
                }}
              >
                Avbryt
              </Button>
              <Button
                onClick={createWorkOrder}
                loading={submittingCreate}
                disabled={!createForm.title.trim()}
              >
                Skapa
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      <Modal
        open={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title={selectedWorkOrder?.title || 'Arbetsorder'}
        size="xl"
      >
        {selectedWorkOrder && (
          <div className="space-y-6">
            {/* Work order info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Titel</p>
                <p className="text-sm text-slate-800 font-medium">{selectedWorkOrder.title}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Kategori</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.category}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Prioritet</p>
                <Badge className={getWOPriorityColor(selectedWorkOrder.priority)}>
                  {WO_PRIORITY_LABELS[selectedWorkOrder.priority]}
                </Badge>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Status</p>
                {isStaff ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Select
                      options={WO_STATUSES.map((s) => ({ value: s, label: WO_STATUS_LABELS[s] }))}
                      value={newDetailStatus}
                      onChange={(e) => setNewDetailStatus(e.target.value as WOStatus)}
                      className="text-sm"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={updateWorkOrderStatus}
                      loading={updatingStatus}
                    >
                      Uppdatera
                    </Button>
                  </div>
                ) : (
                  <Badge className={getWOStatusColor(selectedWorkOrder.status)}>
                    {WO_STATUS_LABELS[selectedWorkOrder.status]}
                  </Badge>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Fastighet</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <Building2 className="w-4 h-4" />
                  {selectedWorkOrder.property?.name || '–'}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Lägenhet</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.apartment?.apartment_number || '–'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Hyresgäst</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.tenant?.name || '–'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Förfallodatum</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <Calendar className="w-4 h-4" />
                  {selectedWorkOrder.due_date ? formatDate(selectedWorkOrder.due_date) : '–'}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Skapad av</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.creator?.name || '–'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Skapad</p>
                <p className="text-sm text-slate-800">{formatDateTime(selectedWorkOrder.created_at)}</p>
              </div>

              {isStaff && (
                <div className="md:col-span-2">
                  <p className="text-xs font-medium text-slate-500 uppercase">Tilldelad till</p>
                  <div className="mt-2 space-y-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {staffMembers.map((staff) => (
                        <label key={staff.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={newAssignedToIds.includes(staff.id)}
                            onChange={() => toggleDetailAssignee(staff.id)}
                            className="rounded border-slate-300 accent-blue-600"
                          />
                          <span>{staff.name}</span>
                        </label>
                      ))}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={updateWorkOrderAssignment}
                      loading={updatingAssignment}
                    >
                      Uppdatera tilldelning
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Tilldelad</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <User className="w-4 h-4" />
                  {assigneeNames(selectedWorkOrder)}
                </div>
              </div>
            </div>

            {selectedWorkOrder.description && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-2">Beskrivning</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{selectedWorkOrder.description}</p>
              </div>
            )}

            {selectedWorkOrder.checklist?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-slate-500">Checklista</p>
                <div className="space-y-2">
                  {selectedWorkOrder.checklist.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <CheckSquare className={`h-4 w-4 ${item.done ? 'text-green-600' : 'text-slate-400'}`} />
                      <span>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedWorkOrder.attachments?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-slate-500">Bilagor</p>
                <div className="space-y-2">
                  {selectedWorkOrder.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                    >
                      <Paperclip className="h-4 w-4" />
                      <span className="truncate">{attachment.name}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Time logged */}
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
              <Clock className="w-4 h-4 text-slate-600" />
              <div>
                <p className="text-xs font-medium text-slate-500">Tid loggad</p>
                <p className="text-sm font-medium text-slate-800">{formatMinutes(totalTimeLogged)}</p>
              </div>
            </div>

            {/* Comments section */}
            <div className="border-t border-slate-200 pt-4">
              <h3 className="font-semibold text-slate-800 mb-3">Kommentarer</h3>

              {loadingComments ? (
                <p className="text-sm text-slate-500">Laddar kommentarer...</p>
              ) : comments.length === 0 ? (
                <p className="text-sm text-slate-500 mb-4">Inga kommentarer ännu</p>
              ) : (
                <div className="space-y-3 mb-4">
                  {comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`p-3 rounded-lg text-sm ${
                        comment.internal ? 'bg-yellow-50 border border-yellow-200' : 'bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-medium text-slate-800">{comment.user?.name || 'Unknown'}</p>
                        {comment.internal && (
                          <Badge className="bg-yellow-100 text-yellow-700">Intern</Badge>
                        )}
                      </div>
                      <p className="text-slate-600">{comment.comment}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {formatDateTime(comment.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Textarea
                  label="Ny kommentar"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Skriv din kommentar..."
                  rows={3}
                />

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="internal"
                    checked={commentInternal}
                    onChange={(e) => setCommentInternal(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <label htmlFor="internal" className="text-sm text-slate-700">
                    Intern kommentar
                  </label>
                </div>

                <Button
                  onClick={addComment}
                  loading={postingComment}
                  disabled={!commentText.trim()}
                  className="w-full"
                >
                  Publicera kommentar
                </Button>
              </div>
            </div>

            {/* Time tracking section */}
            {isStaff && (
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <h3 className="font-semibold text-slate-800">Tidstämpling</h3>
                  <span className="text-sm text-slate-500 ml-auto">
                    Loggad: {formatMinutes(totalTimeLogged)}
                  </span>
                </div>

                {activeTimeEntry?.work_order_id === selectedWorkOrder.id ? (
                  <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-sm text-green-700 font-medium flex-1">Tidrapportering aktiv</span>
                    <Button variant="secondary" size="sm" onClick={handleStampOut} loading={stampingIn} className="gap-1">
                      <Square className="w-3 h-3" />
                      Stämpla ut
                    </Button>
                  </div>
                ) : activeTimeEntry ? (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                    Du har en pågående tidrapport på en annan arbetsorder. Stämpla ut där först.
                  </div>
                ) : (
                  <Button
                    variant="secondary"
                    className="w-full gap-2"
                    onClick={() => setShowStampInModal(true)}
                  >
                    <Play className="w-4 h-4" />
                    Stämpla in på denna arbetsorder
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      {/* Stamp In Modal */}
      {isStaff && selectedWorkOrder && (
        <Modal
          open={showStampInModal}
          onClose={() => setShowStampInModal(false)}
          title={`Stämpla in — ${selectedWorkOrder.title}`}
        >
          <div className="space-y-4">
            <Select
              label="Kategori"
              value={stampCategory}
              onChange={(e) => setStampCategory(e.target.value as TimeCategory)}
              options={Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
            <Textarea
              label="Kommentar (valfritt)"
              value={stampComment}
              onChange={(e) => setStampComment(e.target.value)}
              placeholder="Beskriv vad du ska göra..."
              rows={3}
            />
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowStampInModal(false)} className="flex-1">
                Avbryt
              </Button>
              <Button variant="primary" onClick={handleStampIn} loading={stampingIn} className="flex-1 gap-2">
                <Play className="w-4 h-4" />
                Stämpla in
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
