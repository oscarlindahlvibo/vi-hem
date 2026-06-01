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
  TimeEntry,
} from '../types';
import {
  Plus,
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
} from 'lucide-react';
import { TIME_CATEGORY_LABELS } from '../lib/utils';
import type { TimeCategory } from '../types';

type FilterView = 'all' | 'mine' | 'new' | 'urgent';

interface WOWithRelations extends WorkOrder {
  property?: Property;
  apartment?: { apartment_number: string };
  tenant?: Profile;
  assigned?: Profile;
  creator?: Profile;
}

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

export function WorkOrdersPage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  const [workOrders, setWorkOrders] = useState<WOWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<WOStatus | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<WOPriority | 'all'>('all');
  const [filterView, setFilterView] = useState<FilterView>('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WOWithRelations | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [staffMembers, setStaffMembers] = useState<Profile[]>([]);
  const [comments, setComments] = useState<WorkOrderComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [totalTimeLogged, setTotalTimeLogged] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Create form state
  const [createForm, setCreateForm] = useState({
    title: '',
    description: '',
    category: WO_CATEGORIES[0],
    priority: 'normal' as WOPriority,
    status: 'new' as WOStatus,
    property_id: '',
    apartment_id: '',
    tenant_id: '',
    due_date: '',
    assigned_to: '',
  });
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Detail modal state
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newDetailStatus, setNewDetailStatus] = useState<WOStatus>('new');
  const [updatingAssignment, setUpdatingAssignment] = useState(false);
  const [newAssignedTo, setNewAssignedTo] = useState('');

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
      setWorkOrders(data || []);
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
      const { error } = await supabase.from('work_orders').insert([
        {
          title: createForm.title,
          description: createForm.description,
          category: createForm.category,
          priority: createForm.priority,
          status: createForm.status,
          property_id: createForm.property_id || null,
          apartment_id: createForm.apartment_id || null,
          tenant_id: createForm.tenant_id || null,
          due_date: createForm.due_date || null,
          assigned_to: createForm.assigned_to || null,
          created_by: user.id,
        },
      ]);

      if (error) throw error;
      setCreateForm({
        title: '',
        description: '',
        category: WO_CATEGORIES[0],
        priority: 'normal',
        status: 'new',
        property_id: '',
        apartment_id: '',
        tenant_id: '',
        due_date: '',
        assigned_to: '',
      });
      setShowCreateModal(false);
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error creating work order:', err);
    } finally {
      setSubmittingCreate(false);
    }
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
      const { error } = await supabase
        .from('work_orders')
        .update({ assigned_to: newAssignedTo || null })
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;
      setSelectedWorkOrder({ ...selectedWorkOrder, assigned_to: newAssignedTo || null });
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating assignment:', err);
    } finally {
      setUpdatingAssignment(false);
    }
  }

  async function checkActiveTimeEntry() {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('time_entries')
      .select('id, work_order_id')
      .eq('user_id', user.id)
      .eq('status', 'draft')
      .gte('start_time', today)
      .is('end_time', null)
      .maybeSingle();
    setActiveTimeEntry(data || null);
  }

  async function handleStampIn() {
    if (!user || !selectedWorkOrder) return;
    try {
      setStampingIn(true);
      const { error } = await supabase.from('time_entries').insert({
        user_id: user.id,
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
      const { data: entry } = await supabase
        .from('time_entries')
        .select('start_time, break_minutes')
        .eq('id', activeTimeEntry.id)
        .single();
      if (!entry) return;
      const endTime = new Date().toISOString();
      const totalMinutes = Math.max(
        Math.floor((Date.now() - new Date(entry.start_time).getTime()) / 60000) - (entry.break_minutes || 0),
        0
      );
      await supabase
        .from('time_entries')
        .update({ end_time: endTime, total_minutes: totalMinutes, status: 'submitted' })
        .eq('id', activeTimeEntry.id);
      setActiveTimeEntry(null);
      await fetchTimeLogged();
    } catch (err) {
      console.error('Failed to stamp out:', err);
    } finally {
      setStampingIn(false);
    }
  }

  function filteredWorkOrders() {
    return workOrders.filter((wo) => {
      const matchesSearch = wo.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === 'all' || wo.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || wo.priority === filterPriority;

      let matchesView = true;
      if (filterView === 'mine') {
        matchesView = wo.assigned_to === user?.id;
      } else if (filterView === 'new') {
        matchesView = wo.status === 'new';
      } else if (filterView === 'urgent') {
        matchesView = wo.priority === 'urgent' || wo.priority === 'high';
      }

      return matchesSearch && matchesStatus && matchesPriority && matchesView;
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
  const statusGroups = viewMode === 'kanban' ? workOrdersByStatus() : {};

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
              ...WO_STATUSES.map((s) => ({ value: s, label: WO_STATUS_LABELS[s] })),
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
              { value: 'all', label: 'Alla' },
              { value: 'mine', label: 'Mina' },
              { value: 'new', label: 'Ny' },
              { value: 'urgent', label: 'Akuta' },
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
              ...WO_STATUSES.map((s) => ({ value: s, label: WO_STATUS_LABELS[s] })),
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
            label="Visa"
            options={[
              { value: 'all', label: 'Alla' },
              { value: 'mine', label: 'Mina' },
              { value: 'new', label: 'Ny' },
              { value: 'urgent', label: 'Akuta' },
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
          description="Det finns inga arbetsordrar som matchar dina filter."
          action={
            isStaff ? (
              <Button onClick={() => setShowCreateModal(true)} variant="primary" size="sm">
                <Plus className="w-4 h-4" />
                Skapa arbetsorder
              </Button>
            ) : null
          }
        />
      ) : viewMode === 'list' ? (
        <Card className="overflow-hidden">
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
                      setNewAssignedTo(wo.assigned_to || '');
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
                      {wo.assigned?.name || '–'}
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
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto pb-4">
            <div className="flex gap-4 min-w-max">
              {WO_STATUSES.map((status) => (
                <div
                  key={status}
                  className="flex-shrink-0 w-80 bg-slate-50 rounded-xl border border-slate-200 p-4"
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
                          setNewAssignedTo(wo.assigned_to || '');
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

                          {wo.assigned?.name && (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <User className="w-3 h-3" />
                              {wo.assigned.name}
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
          onClose={() => setShowCreateModal(false)}
          title="Ny arbetsorder"
        >
          <div className="space-y-4">
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
              onChange={(e) => setCreateForm({ ...createForm, property_id: e.target.value })}
            />

            <Input
              label="Lägenhetsnummer"
              value={createForm.apartment_id}
              onChange={(e) => setCreateForm({ ...createForm, apartment_id: e.target.value })}
              placeholder="T.ex. 201"
            />

            <Input
              label="Hyresgäst ID"
              value={createForm.tenant_id}
              onChange={(e) => setCreateForm({ ...createForm, tenant_id: e.target.value })}
              placeholder="Lägg till hyresgäst om relevant"
            />

            <Input
              label="Förfallodatum"
              type="date"
              value={createForm.due_date}
              onChange={(e) => setCreateForm({ ...createForm, due_date: e.target.value })}
            />

            <Select
              label="Tilldelad till"
              options={[{ value: '', label: '- Ingen -' }, ...staffMembers.map((s) => ({ value: s.id, label: s.name }))]}
              value={createForm.assigned_to}
              onChange={(e) => setCreateForm({ ...createForm, assigned_to: e.target.value })}
            />

            <div className="flex gap-2 pt-4">
              <Button
                variant="secondary"
                onClick={() => setShowCreateModal(false)}
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
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Tilldelad till</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Select
                      options={[{ value: '', label: '- Ingen -' }, ...staffMembers.map((s) => ({ value: s.id, label: s.name }))]}
                      value={newAssignedTo}
                      onChange={(e) => setNewAssignedTo(e.target.value)}
                      className="text-sm flex-1"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={updateWorkOrderAssignment}
                      loading={updatingAssignment}
                    >
                      Uppdatera
                    </Button>
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase">Tilldelad</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <User className="w-4 h-4" />
                  {selectedWorkOrder.assigned?.name || '–'}
                </div>
              </div>
            </div>

            {selectedWorkOrder.description && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-2">Beskrivning</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{selectedWorkOrder.description}</p>
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
