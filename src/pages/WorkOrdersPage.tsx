import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { WorkOrderChatFiles } from '../components/chat/WorkOrderChatFiles';
import { ContextChatLauncher } from '../components/chat/ContextChatLauncher';
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Avatar,
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
  Tabs,
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
  createClientId,
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
  Trash2,
  CheckCircle2,
  RotateCcw,
  Tag,
  MoreHorizontal,
  Lock,
  Repeat,
  SlidersHorizontal,
  ListChecks,
} from 'lucide-react';
import { TIME_CATEGORY_LABELS } from '../lib/utils';
import { useTimeCategories } from '../contexts/TimeCategoriesContext';
import { useWorkOrderCategories, type WorkOrderCategoryOption } from '../contexts/WorkOrderCategoriesContext';
import { archiveFileInGoogleDrive } from '../lib/googleDriveStorage';
import type { TimeCategory } from '../types';
import { WorkOrderOperationsPanel } from '../components/WorkOrderOperationsPanel';
import { WorkOrderCard } from '../components/workorders/WorkOrderCard';
import { AssigneeSheet, CommentModeToggle, CommentSheet, DueDateSheet, SwitchJobSheet, WorkOrderActionSheet, actionIcons, type QuickAction } from '../components/workorders/WorkOrderSheets';
import { SkeletonList } from '../components/ui';
import { useToast } from '../components/toast';
import { fetchOpenTimeEntries, startOrSwitchToWorkOrder, type OpenTimeEntry } from '../lib/timeClock';

type FilterView = 'all' | 'mine' | 'unassigned' | 'overdue';
type WorkOrderListTab = 'active' | 'archived';
type WorkOrderSort = 'due_date' | 'created_at' | 'updated_at' | 'priority';
type QuickSheet = { kind: 'actions' | 'due' | 'assignee' | 'comment' | 'switch'; id: string } | null;
const PRIORITY_RANK: Record<WOPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type WorkOrderPerson = Pick<Profile, 'name'>;

interface WOWithRelations extends Omit<WorkOrder, 'property' | 'apartment' | 'tenant' | 'assigned' | 'creator'> {
  property?: Pick<Property, 'name' | 'address'>;
  apartment?: { apartment_number: string };
  tenant?: WorkOrderPerson;
  assigned?: WorkOrderPerson;
  creator?: WorkOrderPerson;
  maintenance_request?: { id: string; title: string; status: string; tenant_id: string } | null;
  customer_project?: { title: string | null; name: string | null } | null;
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

type EditWorkOrderForm = {
  title: string;
  description: string;
  category: string;
  priority: WOPriority;
  property_id: string;
  apartment_id: string;
  tenant_id: string;
  due_date: string;
};

const defaultEditForm: EditWorkOrderForm = {
  title: '',
  description: '',
  category: WO_CATEGORIES[0],
  priority: 'normal',
  property_id: '',
  apartment_id: '',
  tenant_id: '',
  due_date: '',
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

function formatScheduleWindow(order: Pick<WorkOrder, 'scheduled_start_at' | 'scheduled_end_at'>) {
  if (!order.scheduled_start_at || !order.scheduled_end_at) return '';
  const start = new Date(order.scheduled_start_at);
  const end = new Date(order.scheduled_end_at);
  const sameDay = start.toDateString() === end.toDateString();
  const date = start.toLocaleDateString('sv-SE');
  const startTime = start.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const endTime = end.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `${date} ${startTime}-${endTime}` : `${formatDateTime(start)} - ${formatDateTime(end)}`;
}

function isWorkOrderOverdue(order: Pick<WorkOrder, 'status' | 'due_date' | 'scheduled_end_at'>) {
  if (ARCHIVED_WO_STATUSES.includes(order.status)) return false;
  if (order.scheduled_end_at) return new Date(order.scheduled_end_at).getTime() < Date.now();
  return Boolean(order.due_date && new Date(`${order.due_date}T23:59:59`).getTime() < Date.now());
}

function WorkOrderCategoryManagerModal({ open, onClose, organisationId, userId }: {
  open: boolean; onClose: () => void; organisationId: string | null; userId: string;
}) {
  const { refresh } = useWorkOrderCategories();
  const [allCategories, setAllCategories] = useState<WorkOrderCategoryOption[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadAll() {
    if (!organisationId) return;
    const { data } = await supabase
      .from('vihem_work_order_categories')
      .select('id, key, label, active, sort_order, is_builtin')
      .eq('organisation_id', organisationId)
      .order('sort_order', { ascending: true });
    setAllCategories((data || []) as WorkOrderCategoryOption[]);
  }

  useEffect(() => { if (open) loadAll(); }, [open, organisationId]);

  function slugify(label: string) {
    const base = label
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return base || `kategori_${Date.now()}`;
  }

  async function handleAdd() {
    if (!organisationId || !newLabel.trim()) return;
    setSaving(true);
    setError('');
    try {
      let key = slugify(newLabel);
      if (allCategories.some(c => c.key === key)) key = `${key}_${Date.now().toString(36)}`;
      const { error: insertError } = await supabase.from('vihem_work_order_categories').insert({
        organisation_id: organisationId,
        key,
        label: newLabel.trim(),
        sort_order: allCategories.length + 1,
        is_builtin: false,
        created_by: userId,
      });
      if (insertError) throw insertError;
      setNewLabel('');
      await loadAll();
      await refresh();
    } catch (err: any) {
      setError(err.message || 'Kunde inte lägga till kategorin.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(id: string, active: boolean) {
    await supabase.from('vihem_work_order_categories').update({ active }).eq('id', id);
    await loadAll();
    await refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Kategorier för arbetsordrar">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Kategorierna visas när en arbetsorder skapas eller redigeras. Grundkategorierna kan inte tas bort, men egna kategorier går att lägga till och inaktivera.
        </p>
        <div className="space-y-2">
          {allCategories.map(c => (
            <div key={c.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${c.active ? 'border-slate-200' : 'border-slate-100 bg-slate-50'}`}>
              <span className={`text-sm ${c.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                {c.label}{c.is_builtin && <span className="ml-2 text-xs text-slate-400 no-underline">Grundkategori</span>}
              </span>
              {!c.is_builtin && (
                <Button variant="ghost" size="sm" onClick={() => handleToggleActive(c.id, !c.active)}>
                  {c.active ? 'Inaktivera' : 'Aktivera'}
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ny kategori, t.ex. Larm" className="flex-1" />
          <Button variant="primary" onClick={handleAdd} loading={saving} disabled={!newLabel.trim()}>
            <Plus className="w-4 h-4" /> Lägg till
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

export function WorkOrdersPage({ onNavigate: _onNavigate, initialWorkOrderId, sourceChatMessageId }: { onNavigate: (page: string) => void; initialWorkOrderId?: string; sourceChatMessageId?: string }) {
  const { user, loading: authLoading } = useAuth();
  const { categories: timeCategories } = useTimeCategories();
  const { categories: woCategories } = useWorkOrderCategories();
  const [workOrders, setWorkOrders] = useState<WOWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<WOStatus | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<WOPriority | 'all'>('all');
  const [filterView, setFilterView] = useState<FilterView>('all');
  const [sortBy, setSortBy] = useState<WorkOrderSort>('due_date');
  const [listTab, setListTab] = useState<WorkOrderListTab>('active');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WOWithRelations | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const openedInitialOrder = useRef<string | undefined>(undefined);
  const detailSaveLock = useRef(false);
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
  const [selectedWorkOrderIds, setSelectedWorkOrderIds] = useState<string[]>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const toast = useToast();
  const [selectMode, setSelectMode] = useState(false);
  const [quickSheet, setQuickSheet] = useState<QuickSheet>(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [openEntry, setOpenEntry] = useState<OpenTimeEntry | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [savingClose, setSavingClose] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'comments' | 'time' | 'history'>('overview');
  const [history, setHistory] = useState<{ id: string; event_type: string; actor_id: string | null; created_at: string; metadata: Record<string, any> }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Create form state
  const [chatSourceFile,setChatSourceFile]=useState<{id:string;name:string}|null>(null),[includeChatFile,setIncludeChatFile]=useState(false);
  const createdFromChat=useRef<string|null>(null);
  const [createForm, setCreateForm] = useState<CreateWorkOrderForm>(defaultCreateForm);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [discardForm, setDiscardForm] = useState<'create' | 'edit' | null>(null);
  const createDirty = useUnsavedChanges({ ...createForm, files: createForm.files.map(f => [f.name, f.size, f.lastModified]), includeChatFile }, showCreateModal);

  // Detail modal state
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newDetailStatus, setNewDetailStatus] = useState<WOStatus>('new');
  const [updatingAssignment, setUpdatingAssignment] = useState(false);
  const [newAssignedToIds, setNewAssignedToIds] = useState<string[]>([]);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);

  // Edit modal state -- status has its own dropdown+button and assignment
  // its own checkboxes+button already in the detail view (both work fine),
  // this covers the rest of the order (title, description, category,
  // priority, property/apartment/tenant, due date) which previously had no
  // way to change at all after creation.
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditWorkOrderForm>(defaultEditForm);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const editDirty = useUnsavedChanges(editForm, showEditModal);
  const editSubmission = useRef(false);
  const commentSubmission = useRef(false);
  const [commentError, setCommentError] = useState('');
  // Keep unfinished comments attached to their order; never carry text into
  // another customer's order while navigating between detail views.
  const commentDrafts = useRef(new Map<string, { text: string; internal: boolean }>());
  const previousCommentOrder = useRef<string | null>(null);
  const latestCommentDraft = useRef({ text: commentText, internal: commentInternal });
  latestCommentDraft.current = { text: commentText, internal: commentInternal };
  useEffect(() => {
    if (previousCommentOrder.current) commentDrafts.current.set(previousCommentOrder.current, latestCommentDraft.current);
    const id = selectedWorkOrder?.id || null;
    previousCommentOrder.current = id;
    const draft = id ? commentDrafts.current.get(id) : undefined;
    setCommentText(draft?.text || '');
    setCommentInternal(draft?.internal || false);
    setCommentError('');
  }, [selectedWorkOrder?.id]);


  // Stamp-in state (inline, tied to work order detail)
  const [showStampInModal, setShowStampInModal] = useState(false);
  const [stampCategory, setStampCategory] = useState<TimeCategory>('work_order');
  const [stampComment, setStampComment] = useState('');
  const [stampingIn, setStampingIn] = useState(false);
  const [activeTimeEntry, setActiveTimeEntry] = useState<{ id: string; work_order_id: string | null } | null>(null);

  const isStaff = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newChecklistItemText, setNewChecklistItemText] = useState('');
  const [savingChecklist, setSavingChecklist] = useState(false);
  const categoryOptions = (woCategories.length > 0 ? woCategories.map(c => c.label) : WO_CATEGORIES).map(label => ({ value: label, label }));

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

  async function refreshOpenEntry() {
    if (!user || !isStaff) return;
    try {
      const entries = await fetchOpenTimeEntries(user.id);
      setOpenEntry(entries[entries.length - 1] || null);
    } catch (err) {
      console.error('Error loading open time entry:', err);
    }
  }

  useEffect(() => {
    if (!authLoading && user && isStaff) refreshOpenEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, isStaff]);

  useEffect(() => {
    if (!initialWorkOrderId) { openedInitialOrder.current = undefined; return; }
    if (openedInitialOrder.current === initialWorkOrderId || loading || workOrders.length === 0) return;
    const workOrder = workOrders.find((order) => order.id === initialWorkOrderId);
    if (workOrder) {
      openedInitialOrder.current = initialWorkOrderId;
      setSelectedWorkOrder(workOrder);
      setNewDetailStatus(workOrder.status);
      setNewAssignedToIds(workOrder.assigned_to_ids?.length ? workOrder.assigned_to_ids : workOrder.assigned_to ? [workOrder.assigned_to] : []);
      setShowDetailModal(true);
    }
  }, [initialWorkOrderId, loading, workOrders]);

  useEffect(() => {
    if (!sourceChatMessageId || !user || !isStaff) return;
    createdFromChat.current=null;setChatSourceFile(null);setIncludeChatFile(false);
    let live = true;
    void supabase.from('vihem_chat_messages').select('id,message,deleted_at,attachment_path,attachment_name,thread:vihem_chat_threads(property_id,tenant_id,maintenance_request_id)').eq('id', sourceChatMessageId).maybeSingle().then(async ({ data, error }) => {
      if (!live) return;
      if (error || !data || data.deleted_at) { setCreateError('Meddelandet kunde inte hämtas.'); setShowCreateModal(true); return; }
      if(data.attachment_path)setChatSourceFile({id:data.id,name:data.attachment_name||'Bilaga'});
      const thread = (Array.isArray(data.thread) ? data.thread[0] : data.thread) as { property_id: string | null; tenant_id: string | null; maintenance_request_id: string | null } | null;
      let apartmentId = '', propertyId = thread?.property_id || '';
      if (thread?.maintenance_request_id) {
        const { data: request } = await supabase.from('vihem_maintenance_requests').select('property_id,apartment_id').eq('id', thread.maintenance_request_id).maybeSingle();
        apartmentId = request?.apartment_id || ''; propertyId ||= request?.property_id || '';
      }
      if (!live) return;
      setCreateForm({ ...defaultCreateForm, title: data.message.split('\n')[0].slice(0,100), description: data.message, property_id: propertyId, apartment_id: apartmentId, tenant_id: thread?.tenant_id || '' });
      setShowCreateModal(true);
    });
    return () => { live = false; };
  }, [sourceChatMessageId, user?.id, isStaff]);

  // Fetch comments when detail modal opens
  useEffect(() => {
    if (showDetailModal && selectedWorkOrder) {
      fetchComments();
      fetchTimeLogged();
      if (isStaff) { checkActiveTimeEntry(); fetchHistory(); }
    }
  }, [showDetailModal, selectedWorkOrder?.id]);

  useEffect(() => {
    if (showDetailModal) setDetailTab('overview');
  }, [showDetailModal, selectedWorkOrder?.id]);

  useEffect(() => {
    setSelectedWorkOrderIds([]);
    setBulkError('');
  }, [searchQuery, filterStatus, filterPriority, filterView, sortBy, listTab, viewMode]);

  async function fetchWorkOrders() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vihem_work_orders')
        .select(
          `*,
          property:vihem_properties(name,address),
          apartment:vihem_apartments(apartment_number),
          tenant:vihem_profiles!work_orders_tenant_id_fkey(name),
          assigned:vihem_profiles!work_orders_assigned_to_fkey(name),
          creator:vihem_profiles!work_orders_created_by_fkey(name),
          maintenance_request:vihem_maintenance_requests(id,title,status,tenant_id),
          customer_project:vihem_customer_projects(title,name)`
        )
        .order('created_at', { ascending: false });

      if (error) throw error;
      const refreshed = (data || []) as unknown as WOWithRelations[];
      setWorkOrders(refreshed);
      setSelectedWorkOrder(current => current ? refreshed.find(order => order.id === current.id) || current : current);
    } catch (err) {
      console.error('Error fetching work orders:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchProperties() {
    try {
      const { data, error } = await supabase
        .from('vihem_properties')
        .select('*')
        .eq('active', true)
        .order('name');

      if (error) throw error;
      setProperties(data || []);
    } catch (err) {
      console.error('Error fetching vihem_properties:', err);
    }
  }

  async function fetchStaffMembers() {
    try {
      const { data, error } = await supabase
        .from('vihem_profiles')
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
        .from('vihem_apartments')
        .select('*')
        .order('apartment_number');

      if (error) throw error;
      setApartments(data || []);
    } catch (err) {
      console.error('Error fetching vihem_apartments:', err);
    }
  }

  async function fetchTenants() {
    try {
      const { data, error } = await supabase
        .from('vihem_profiles')
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
        .from('vihem_work_order_comments')
        .select('*, user:vihem_profiles(name)')
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

  async function fetchHistory() {
    if (!selectedWorkOrder || !isStaff) return;
    try {
      setLoadingHistory(true);
      const { data, error } = await supabase
        .from('vihem_audit_events')
        .select('id, event_type, actor_id, created_at, metadata')
        .eq('entity_type', 'work_order')
        .eq('entity_id', selectedWorkOrder.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setHistory((data || []) as typeof history);
    } catch (err) {
      console.error('Error fetching work order history:', err);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function fetchTimeLogged() {
    if (!selectedWorkOrder) return;
    try {
      const { data, error } = await supabase
        .from('vihem_time_entries')
        .select('total_minutes')
        .eq('work_order_id', selectedWorkOrder.id);

      if (error) throw error;
      const total = (data || []).reduce((sum, entry) => sum + (entry.total_minutes || 0), 0);
      setTotalTimeLogged(total);
    } catch (err) {
      console.error('Error fetching time logged:', err);
    }
  }

  const createSubmission = useRef(false);
  async function createWorkOrder() {
    if (!user || !createForm.title.trim() || createSubmission.current) return;
    createSubmission.current = true;

    try {
      setSubmittingCreate(true);
      setCreateError('');
      if(createdFromChat.current&&includeChatFile&&chatSourceFile){const {error}=await supabase.functions.invoke('vihem-chat-to-workorder',{body:{work_order_id:createdFromChat.current,message_id:chatSourceFile.id}});if(error)throw new Error('Arbetsordern är skapad, men bilagan kunde inte kopieras. Tryck på Skapa igen för att försöka kopiera bilagan utan att skapa en ny arbetsorder.');createdFromChat.current=null;setChatSourceFile(null);setShowCreateModal(false);await fetchWorkOrders();return;}
      const workOrderId = createClientId();
      const attachments = await uploadWorkOrderFiles(workOrderId, createForm.files, user.id);
      const checklist = createForm.checklist
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ id: createClientId(), text, done: false }));
      const assignedIds = createForm.assigned_to_ids;
      const { error } = await supabase.from('vihem_work_orders').insert([
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
      if(includeChatFile&&chatSourceFile){createdFromChat.current=workOrderId;const {error:copyError}=await supabase.functions.invoke('vihem-chat-to-workorder',{body:{work_order_id:workOrderId,message_id:chatSourceFile.id}});if(copyError)throw new Error('Arbetsordern är skapad, men bilagan kunde inte kopieras. Tryck på Skapa igen för att försöka kopiera bilagan utan att skapa en ny arbetsorder.');}
      createdFromChat.current=null;setChatSourceFile(null);
      setCreateForm(defaultCreateForm);
      setShowCreateModal(false);
      toast.show('Arbetsordern är skapad');
      await fetchWorkOrders();
    } catch (err: any) {
      console.error('Error creating work order:', err);
      setCreateError(createdFromChat.current ? 'Arbetsordern är skapad, men chattbilagan kunde inte kopieras. Försök igen så kopieras bilagan till samma arbetsorder.' : 'Arbetsordern kunde inte sparas. Uppgifterna finns kvar. Kontrollera anslutningen och försök igen.');
    } finally {
      createSubmission.current = false;
      setSubmittingCreate(false);
    }
  }

  async function uploadWorkOrderFiles(workOrderId: string, files: File[], userId: string): Promise<AttachmentItem[]> {
    if (files.length === 0) return [];

    const uploaded: AttachmentItem[] = [];
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const path = `work-orders/${workOrderId}/${createClientId()}-${safeName}`;
      const { error } = await supabase.storage
        .from('vihem-work-order-attachments')
        .upload(path, file, { upsert: false });

      if (error) {
        if (error.message.toLowerCase().includes('bucket not found')) {
          throw new Error(
            `Kunde inte ladda upp ${file.name}: storage-bucketen vihem-work-order-attachments saknas. Kör senaste Supabase-migrationerna på miljön först.`
          );
        }
        throw new Error(`Kunde inte ladda upp ${file.name}: ${error.message}`);
      }

      const { data } = supabase.storage.from('vihem-work-order-attachments').getPublicUrl(path);
      uploaded.push({
        id: createClientId(),
        name: file.name,
        url: data.publicUrl,
        path,
        type: file.type,
        size: file.size,
        uploaded_at: new Date().toISOString(),
        uploaded_by: userId,
      });
      if (user?.organisation_id) {
        try {
          await archiveFileInGoogleDrive({ file, folder: 'Arbetsorder', organisation_id: user.organisation_id, source_type: 'work_order_attachment', source_id: workOrderId, source_key: path, created_by: userId });
        } catch (driveError) {
          console.warn('Kunde inte arkivera arbetsorderbilagan i Google Drive:', driveError);
        }
      }
    }
    return uploaded;
  }

  async function deleteWorkOrderAttachment(attachment: AttachmentItem) {
    if (!selectedWorkOrder || !isStaff) return;
    if (!window.confirm(`Ta bort bilagan "${attachment.name}"?`)) return;

    try {
      setDeletingAttachmentId(attachment.id);
      const nextAttachments = (selectedWorkOrder.attachments || []).filter((item) => item.id !== attachment.id);

      if (attachment.path) {
        const { error: storageError } = await supabase.storage
          .from('vihem-work-order-attachments')
          .remove([attachment.path]);

        if (storageError) {
          throw new Error(`Kunde inte ta bort filen från lagringen: ${storageError.message}`);
        }
      }

      const { error } = await supabase
        .from('vihem_work_orders')
        .update({ attachments: nextAttachments })
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;

      const updatedWorkOrder = { ...selectedWorkOrder, attachments: nextAttachments };
      setSelectedWorkOrder(updatedWorkOrder);
      setWorkOrders((orders) => orders.map((order) => (
        order.id === selectedWorkOrder.id ? { ...order, attachments: nextAttachments } : order
      )));
    } catch (err: any) {
      console.error('Error deleting work order attachment:', err);
      alert(err.message || 'Kunde inte ta bort bilagan. Försök igen.');
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function addComment() {
    if (!user || !selectedWorkOrder || !commentText.trim() || commentSubmission.current) return;
    commentSubmission.current = true;
    setCommentError('');

    try {
      setPostingComment(true);
      const { error } = await supabase.from('vihem_work_order_comments').insert([
        {
          work_order_id: selectedWorkOrder.id,
          user_id: user.id,
          comment: commentText,
          internal: commentInternal,
        },
      ]);

      if (error) throw error;
      setCommentText('');
      toast.show(commentInternal ? 'Intern anteckning sparad' : 'Meddelande skickat till kund');
      setCommentInternal(false);
      await fetchComments();
    } catch (err) {
      console.error('Error posting comment:', err);
      setCommentError('Kommentaren kunde inte sparas. Texten finns kvar så att du kan försöka igen.');
    } finally {
      commentSubmission.current = false;
      setPostingComment(false);
    }
  }

  async function syncLinkedMaintenanceStatus(maintenanceRequestId: string | null) {
    if (!maintenanceRequestId) return;

    const { data: linkedOrders, error: linkedOrdersError } = await supabase
      .from('vihem_work_orders')
      .select('status')
      .eq('maintenance_request_id', maintenanceRequestId);

    if (linkedOrdersError) throw linkedOrdersError;

    const statuses = (linkedOrders || []).map(order => order.status as WOStatus);
    const openStatuses = statuses.filter(status => !ARCHIVED_WO_STATUSES.includes(status));
    const completedCount = statuses.filter(status => status === 'completed').length;
    let customerStatus: 'received' | 'assigned' | 'started' | 'waiting_material' | 'waiting_contractor' | 'done' | 'closed' = 'received';

    if (openStatuses.length === 0) {
      customerStatus = completedCount > 0 ? 'done' : 'closed';
    } else if (openStatuses.includes('waiting_material')) {
      customerStatus = 'waiting_material';
    } else if (openStatuses.includes('waiting_contractor')) {
      customerStatus = 'waiting_contractor';
    } else if (openStatuses.some(status => ['started', 'paused', 'waiting_tenant', 'ready_for_check'].includes(status))) {
      customerStatus = 'started';
    } else if (openStatuses.some(status => ['assigned', 'new'].includes(status))) {
      customerStatus = 'assigned';
    }

    const { error: maintenanceError } = await supabase
      .from('vihem_maintenance_requests')
      .update({ status: customerStatus, updated_at: new Date().toISOString() })
      .eq('id', maintenanceRequestId);

    if (maintenanceError) throw maintenanceError;
  }

  async function updateWorkOrderStatus() {
    if (!selectedWorkOrder || !newDetailStatus) return;

    try {
      setUpdatingStatus(true);
      const { error } = await supabase
        .from('vihem_work_orders')
        .update({ status: newDetailStatus })
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;
      await syncLinkedMaintenanceStatus(selectedWorkOrder.maintenance_request_id);
      setSelectedWorkOrder(current => current ? { ...current, status: newDetailStatus } : current);
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating status:', err);
      throw err;
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function bulkUpdateWorkOrders(action: 'complete' | 'archive' | 'reopen') {
    if (!isStaff || selectedWorkOrderIds.length === 0) return;

    const now = new Date().toISOString();
    const status: WOStatus = action === 'complete' ? 'completed' : action === 'archive' ? 'cancelled' : 'assigned';
    const payload = {
      status,
      completed_at: action === 'complete' ? now : null,
      updated_at: now,
    };

    try {
      setBulkUpdating(true);
      setBulkError('');
      const ids = selectedWorkOrderIds;
      const { error } = await supabase
        .from('vihem_work_orders')
        .update(payload)
        .in('id', ids);

      if (error) throw error;

      const linkedMaintenanceRequestIds = [...new Set(
        workOrders
          .filter(order => ids.includes(order.id) && order.maintenance_request_id)
          .map(order => order.maintenance_request_id as string)
      )];
      await Promise.all(linkedMaintenanceRequestIds.map(syncLinkedMaintenanceStatus));

      setWorkOrders((orders) => orders.map((order) => (
        ids.includes(order.id) ? { ...order, ...payload } : order
      )));
      if (selectedWorkOrder && ids.includes(selectedWorkOrder.id)) {
        setSelectedWorkOrder({ ...selectedWorkOrder, ...payload });
        setNewDetailStatus(status);
      }
      setSelectedWorkOrderIds([]);
      await fetchWorkOrders();
    } catch (err: any) {
      console.error('Error bulk updating work orders:', err);
      setBulkError(err.message || 'Kunde inte uppdatera valda arbetsordrar.');
    } finally {
      setBulkUpdating(false);
    }
  }

  async function updateWorkOrderAssignment() {
    if (!selectedWorkOrder) return;

    try {
      setUpdatingAssignment(true);
      const assignedIds = newAssignedToIds;
      const { error } = await supabase
        .from('vihem_work_orders')
        .update({ assigned_to: assignedIds[0] || null, assigned_to_ids: assignedIds })
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;
      setSelectedWorkOrder(current => current ? { ...current, assigned_to: assignedIds[0] || null, assigned_to_ids: assignedIds } : current);
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating assignment:', err);
      throw err;
    } finally {
      setUpdatingAssignment(false);
    }
  }

  async function updateChecklist(nextChecklist: import('../types').ChecklistItem[]) {
    if (!selectedWorkOrder) return;
    setSavingChecklist(true);
    try {
      const { error } = await supabase
        .from('vihem_work_orders')
        .update({ checklist: nextChecklist })
        .eq('id', selectedWorkOrder.id);
      if (error) throw error;
      setSelectedWorkOrder({ ...selectedWorkOrder, checklist: nextChecklist });
      setWorkOrders(orders => orders.map(order => order.id === selectedWorkOrder.id ? { ...order, checklist: nextChecklist } : order));
    } catch (err) {
      console.error('Error updating checklist:', err);
    } finally {
      setSavingChecklist(false);
    }
  }

  function toggleChecklistItem(itemId: string) {
    if (!selectedWorkOrder) return;
    updateChecklist(selectedWorkOrder.checklist.map(item => item.id === itemId ? { ...item, done: !item.done } : item));
  }

  function removeSavedChecklistItem(itemId: string) {
    if (!selectedWorkOrder) return;
    updateChecklist(selectedWorkOrder.checklist.filter(item => item.id !== itemId));
  }

  function addChecklistItem() {
    if (!selectedWorkOrder || !newChecklistItemText.trim()) return;
    updateChecklist([...selectedWorkOrder.checklist, { id: createClientId(), text: newChecklistItemText.trim(), done: false }]);
    setNewChecklistItemText('');
  }

  function openEditModal() {
    if (!selectedWorkOrder || commentSubmission.current) return;
    setEditForm({
      title: selectedWorkOrder.title,
      description: selectedWorkOrder.description || '',
      category: selectedWorkOrder.category || WO_CATEGORIES[0],
      priority: selectedWorkOrder.priority,
      property_id: selectedWorkOrder.property_id || '',
      apartment_id: selectedWorkOrder.apartment_id || '',
      tenant_id: selectedWorkOrder.tenant_id || '',
      due_date: selectedWorkOrder.due_date || '',
    });
    setEditError('');
    // Both modals use the same fixed-inset overlay pattern, so leaving the
    // detail modal "open" underneath would just paint over the edit form.
    setShowDetailModal(false);
    setShowEditModal(true);
  }

  function finishCloseCreate() {
    setShowCreateModal(false);
    createdFromChat.current = null; setChatSourceFile(null); setIncludeChatFile(false);
    setCreateError(''); setDiscardForm(null);
  }
  function closeCreateModal() {
    if (createSubmission.current) return;
    if (createDirty) setDiscardForm('create'); else finishCloseCreate();
  }
  function closeEditModal() {
    if (editSubmission.current) return;
    if (editDirty) { setDiscardForm('edit'); return; }
    finishCloseEdit();
  }
  function finishCloseEdit() {
    setDiscardForm(null);
    setShowEditModal(false);
    setEditError('');
    setShowDetailModal(true);
  }

  async function updateWorkOrderDetails() {
    if (!selectedWorkOrder || !editForm.title.trim() || editSubmission.current) return;
    editSubmission.current = true;

    try {
      setSubmittingEdit(true);
      setEditError('');
      const payload = {
        title: editForm.title,
        description: editForm.description,
        category: editForm.category,
        priority: editForm.priority,
        property_id: editForm.property_id || null,
        apartment_id: editForm.apartment_id || null,
        tenant_id: editForm.tenant_id || null,
        due_date: editForm.due_date || null,
      };
      const { error } = await supabase
        .from('vihem_work_orders')
        .update(payload)
        .eq('id', selectedWorkOrder.id);

      if (error) throw error;
      setSelectedWorkOrder({ ...selectedWorkOrder, ...payload });
      setShowEditModal(false);
      setShowDetailModal(true);
      toast.show('Ändringarna är sparade');
      await fetchWorkOrders();
    } catch (err: any) {
      console.error('Error updating work order:', err);
      setEditError('Ändringarna kunde inte sparas. Uppgifterna finns kvar så att du kan försöka igen.');
    } finally {
      editSubmission.current = false;
      setSubmittingEdit(false);
    }
  }

  async function checkActiveTimeEntry() {
    if (!user) return;
    try {
      const entries = await fetchOpenTimeEntries(user.id);
      const latest = entries[entries.length - 1] || null;
      setOpenEntry(latest);
      setActiveTimeEntry(latest ? { id: latest.id, work_order_id: latest.work_order_id } : null);
    } catch (err) {
      console.error('Error checking active time entry:', err);
    }
  }

  async function handleStampIn() {
    if (!user || !selectedWorkOrder) return;
    try {
      setStampingIn(true);
      await startOrSwitchToWorkOrder({ user, workOrder: selectedWorkOrder, category: stampCategory, comment: stampComment });
      setShowStampInModal(false);
      setStampComment('');
      await checkActiveTimeEntry();
      await fetchTimeLogged();
    } catch (err: any) {
      console.error('Failed to stamp in:', err);
      toast.show(err?.message || 'Kunde inte stämpla in.', { tone: 'error' });
    } finally {
      setStampingIn(false);
    }
  }

  async function handleStampOut() {
    if (!user || !activeTimeEntry) return;
    try {
      setStampingIn(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: openEntries } = await supabase
        .from('vihem_time_entries')
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
          .from('vihem_time_entries')
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

  async function completeOne(wo: WOWithRelations) {
    if (!isStaff || ARCHIVED_WO_STATUSES.includes(wo.status)) return;
    const previous = { status: wo.status, completed_at: wo.completed_at ?? null };
    const now = new Date().toISOString();
    const payload = { status: 'completed' as WOStatus, completed_at: now, updated_at: now };
    const { error } = await supabase.from('vihem_work_orders').update(payload).eq('id', wo.id);
    if (error) {
      toast.show(error.message || 'Kunde inte klarmarkera arbetsordern.', { tone: 'error' });
      return;
    }
    try { await syncLinkedMaintenanceStatus(wo.maintenance_request_id); } catch (err) { console.error(err); }
    setWorkOrders((orders) => orders.map((o) => (o.id === wo.id ? { ...o, ...payload } : o)));
    toast.show('Arbetsordern är klarmarkerad', {
      actionLabel: 'Ångra',
      onAction: async () => {
        const { error: undoError } = await supabase.from('vihem_work_orders')
          .update({ status: previous.status, completed_at: previous.completed_at, updated_at: new Date().toISOString() }).eq('id', wo.id);
        if (undoError) { toast.show(undoError.message || 'Kunde inte ångra.', { tone: 'error' }); return; }
        try { await syncLinkedMaintenanceStatus(wo.maintenance_request_id); } catch (err) { console.error(err); }
        setWorkOrders((orders) => orders.map((o) => (o.id === wo.id ? { ...o, status: previous.status, completed_at: previous.completed_at } : o)));
      },
    });
  }

  async function changeDueDateFor(id: string, date: string) {
    setSheetBusy(true);
    const { error } = await supabase.from('vihem_work_orders').update({ due_date: date }).eq('id', id);
    setSheetBusy(false);
    if (error) { toast.show(error.message || 'Kunde inte ändra förfallodatum.', { tone: 'error' }); return; }
    setWorkOrders((orders) => orders.map((o) => (o.id === id ? { ...o, due_date: date } : o)));
    setSelectedWorkOrder((cur) => (cur && cur.id === id ? { ...cur, due_date: date } : cur));
    setQuickSheet(null);
    toast.show(`Förfallodatum: ${formatDate(date)}`);
  }

  async function changeAssigneesFor(id: string, ids: string[]) {
    setSheetBusy(true);
    const { error } = await supabase.from('vihem_work_orders').update({ assigned_to: ids[0] || null, assigned_to_ids: ids }).eq('id', id);
    setSheetBusy(false);
    if (error) { toast.show(error.message || 'Kunde inte ändra ansvarig.', { tone: 'error' }); return; }
    setWorkOrders((orders) => orders.map((o) => (o.id === id ? { ...o, assigned_to: ids[0] || null, assigned_to_ids: ids } : o)));
    setQuickSheet(null);
    toast.show('Ansvarig uppdaterad');
  }

  async function addCommentTo(id: string, text: string, internal: boolean) {
    if (!user) return;
    setSheetBusy(true);
    const { error } = await supabase.from('vihem_work_order_comments').insert([{ work_order_id: id, user_id: user.id, comment: text, internal }]);
    setSheetBusy(false);
    if (error) { toast.show(error.message || 'Kunde inte publicera kommentaren.', { tone: 'error' }); return; }
    setQuickSheet(null);
    toast.show(internal ? 'Intern anteckning sparad' : 'Meddelande skickat till kund');
  }

  async function startOrSwitchTo(wo: WOWithRelations) {
    if (!user || !isStaff) return;
    setSheetBusy(true);
    try {
      await startOrSwitchToWorkOrder({ user, workOrder: wo, category: 'work_order' as TimeCategory });
      await refreshOpenEntry();
      setQuickSheet(null);
      toast.show(openEntry ? `Du jobbar nu på: ${wo.title}` : `Tidrapportering startad: ${wo.title}`);
      if (selectedWorkOrder?.id === wo.id) { await checkActiveTimeEntry(); await fetchTimeLogged(); }
    } catch (err: any) {
      toast.show(err?.message || 'Kunde inte byta arbetsorder. Inget har ändrats.', { tone: 'error' });
    } finally {
      setSheetBusy(false);
    }
  }

  function filteredWorkOrders() {
    return workOrders.filter((wo) => {
      const isArchived = ARCHIVED_WO_STATUSES.includes(wo.status);
      const matchesTab = listTab === 'archived' ? isArchived : !isArchived;
      const matchesSearch = wo.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === 'all' || wo.status === filterStatus;
      const matchesPriority = filterPriority === 'all' || wo.priority === filterPriority;
      const assignedIds = wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : [];

      let matchesView = true;
      if (filterView === 'mine') {
        matchesView = assignedIds.includes(user?.id || '');
      } else if (filterView === 'unassigned') {
        matchesView = assignedIds.length === 0;
      } else if (filterView === 'overdue') {
        matchesView = isWorkOrderOverdue(wo);
      }

      return matchesTab && matchesSearch && matchesStatus && matchesPriority && matchesView;
    }).sort((a, b) => {
      // Akuta ordrar utan förfallodatum får högsta synlighet oavsett vald sortering.
      const aUrgentWithoutDueDate = a.priority === 'urgent' && !a.due_date;
      const bUrgentWithoutDueDate = b.priority === 'urgent' && !b.due_date;
      if (aUrgentWithoutDueDate !== bUrgentWithoutDueDate) {
        return aUrgentWithoutDueDate ? -1 : 1;
      }

      if (sortBy === 'created_at') {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      if (sortBy === 'updated_at') {
        return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      }
      if (sortBy === 'priority') {
        const diff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (diff !== 0) return diff;
      }

      const aDue = a.due_date ? new Date(`${a.due_date}T12:00:00`).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.due_date ? new Date(`${b.due_date}T12:00:00`).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
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
  const visibleWorkOrderIds = filtered.map((wo) => wo.id);
  const selectedVisibleCount = selectedWorkOrderIds.filter((id) => visibleWorkOrderIds.includes(id)).length;
  const allVisibleSelected = filtered.length > 0 && selectedVisibleCount === filtered.length;
  const toggleWorkOrderSelection = (id: string) => {
    setSelectedWorkOrderIds((current) => current.includes(id)
      ? current.filter((selectedId) => selectedId !== id)
      : [...current, id]);
  };
  const toggleAllVisibleWorkOrders = () => {
    setSelectedWorkOrderIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleWorkOrderIds.includes(id));
      return Array.from(new Set([...current, ...visibleWorkOrderIds]));
    });
  };
  const propertyApartments = createForm.property_id
    ? apartments.filter((apt) => apt.property_id === createForm.property_id)
    : apartments;
  const editPropertyApartments = editForm.property_id
    ? apartments.filter((apt) => apt.property_id === editForm.property_id)
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

  const currentAssigneeIds = selectedWorkOrder
    ? (selectedWorkOrder.assigned_to_ids?.length ? selectedWorkOrder.assigned_to_ids : selectedWorkOrder.assigned_to ? [selectedWorkOrder.assigned_to] : [])
    : [];
  const statusDirty = Boolean(isStaff && selectedWorkOrder && newDetailStatus !== selectedWorkOrder.status);
  const assignmentDirty = Boolean(isStaff && selectedWorkOrder
    && [...newAssignedToIds].sort().join(',') !== [...currentAssigneeIds].sort().join(','));
  const detailDirty = statusDirty || assignmentDirty;
  useUnsavedChanges({ status: newDetailStatus, assignees: newAssignedToIds }, showDetailModal && isStaff);
  const resetDetailPending = () => {
    if (!selectedWorkOrder) return;
    setNewDetailStatus(selectedWorkOrder.status);
    setNewAssignedToIds(currentAssigneeIds);
  };
  const requestCloseDetail = () => {
    if (detailSaveLock.current || commentSubmission.current) return;
    if (detailDirty) setConfirmCloseOpen(true);
    else setShowDetailModal(false);
  };
  const saveAndCloseDetail = async () => {
    if (detailSaveLock.current) return;
    detailSaveLock.current = true;
    setSavingClose(true);
    try {
      if (statusDirty) await updateWorkOrderStatus();
      if (assignmentDirty) await updateWorkOrderAssignment();
      setConfirmCloseOpen(false);
      setShowDetailModal(false);
      toast.show('Ändringarna är sparade');
    } catch (err: any) {
      toast.show(err?.message || 'Kunde inte spara ändringarna.', { tone: 'error' });
    } finally {
      detailSaveLock.current = false;
      setSavingClose(false);
    }
  };
  const discardAndCloseDetail = () => {
    resetDetailPending();
    setConfirmCloseOpen(false);
    setShowDetailModal(false);
  };
  const openWorkOrder = (wo: WOWithRelations) => {
    setSelectedWorkOrder(wo);
    setNewDetailStatus(wo.status);
    setNewAssignedToIds(wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []);
    setShowDetailModal(true);
  };
  const assigneeList = (wo: WOWithRelations): string[] => {
    const ids = wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : [];
    if (ids.length === 0) return wo.assigned?.name ? [wo.assigned.name] : [];
    return ids.map(assigneeName);
  };
  const overdueCount = workOrders.filter((wo) => isWorkOrderOverdue(wo)).length;
  const mineCount = workOrders.filter((wo) => {
    if (ARCHIVED_WO_STATUSES.includes(wo.status)) return false;
    const ids = wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : [];
    return ids.includes(user?.id || '');
  }).length;
  const activeChip: 'all' | 'mine' | 'overdue' | 'archived' = listTab === 'archived' ? 'archived' : filterView === 'mine' ? 'mine' : filterView === 'overdue' ? 'overdue' : 'all';
  const selectChip = (chip: 'all' | 'mine' | 'overdue' | 'archived') => {
    setListTab(chip === 'archived' ? 'archived' : 'active');
    setFilterStatus('all');
    setFilterView(chip === 'mine' ? 'mine' : chip === 'overdue' ? 'overdue' : 'all');
  };
  const chips: { key: 'all' | 'mine' | 'overdue' | 'archived'; label: string; count: number; tone?: 'danger' }[] = [
    { key: 'all', label: 'Alla', count: activeCount },
    ...(isStaff ? [{ key: 'mine' as const, label: 'Mina', count: mineCount }] : []),
    { key: 'overdue', label: 'Försenade', count: overdueCount, tone: 'danger' as const },
    { key: 'archived', label: 'Arkiverade', count: archivedCount },
  ];
  const advancedActive = filterStatus !== 'all' || filterPriority !== 'all' || filterView === 'unassigned' || sortBy !== 'due_date';
  const sheetWo = quickSheet ? workOrders.find((o) => o.id === quickSheet.id) || null : null;
  const openEntryLabel = openEntry
    ? (openEntry.work_order?.title || (openEntry.entry_type === 'break' ? 'Rast' : openEntry.entry_type === 'lunch' ? 'Lunch' : TIME_CATEGORY_LABELS[openEntry.category] || 'Pågående pass'))
    : '';
  const actionsFor = (wo: WOWithRelations): QuickAction[] => {
    const list: QuickAction[] = [
      { key: 'open', label: 'Öppna arbetsordern', icon: actionIcons.open, onSelect: () => openWorkOrder(wo) },
    ];
    if (!isStaff) return list;
    if (!ARCHIVED_WO_STATUSES.includes(wo.status)) {
      if (openEntry?.work_order_id === wo.id) {
        list.push({ key: 'running', label: 'Tidrapportering pågår här', icon: actionIcons.start, hint: 'Stämpla ut i arbetsorderns detaljvy', onSelect: () => openWorkOrder(wo) });
      } else if (openEntry) {
        list.push({ key: 'switch', label: 'Byt till denna arbetsorder', icon: actionIcons.switch, hint: `Pågår: ${openEntryLabel}`, onSelect: () => setQuickSheet({ kind: 'switch', id: wo.id }) });
      } else {
        list.push({ key: 'start', label: 'Starta tidrapportering', icon: actionIcons.start, onSelect: () => startOrSwitchTo(wo) });
      }
    }
    list.push(
      { key: 'assignee', label: 'Ändra ansvarig', icon: actionIcons.assignee, hint: assigneeList(wo).join(', ') || 'Ej tilldelad', onSelect: () => setQuickSheet({ kind: 'assignee', id: wo.id }) },
      { key: 'due', label: 'Ändra förfallodatum', icon: actionIcons.date, hint: wo.due_date ? formatDate(wo.due_date) : 'Inget datum', onSelect: () => setQuickSheet({ kind: 'due', id: wo.id }) },
      { key: 'comment', label: 'Lägg till kommentar', icon: actionIcons.comment, onSelect: () => setQuickSheet({ kind: 'comment', id: wo.id }) },
    );
    if (!ARCHIVED_WO_STATUSES.includes(wo.status)) {
      list.push({ key: 'complete', label: 'Klarmarkera', icon: actionIcons.complete, tone: 'success', onSelect: () => completeOne(wo) });
    }
    return list;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-vihem-ink">Arbetsordrar</h1>
          <p className="text-sm text-vihem-muted">
            {activeCount} aktiva{overdueCount > 0 && <span className="font-semibold text-vihem-danger"> · {overdueCount} försenade</span>}
          </p>
        </div>
        {isStaff && (
          <div className="relative flex shrink-0 items-center gap-2">
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="h-4 w-4" />
              Ny arbetsorder
            </Button>
            {isAdmin && (
              <>
                <button
                  type="button"
                  aria-label="Fler alternativ"
                  aria-expanded={moreMenuOpen}
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
                ><MoreHorizontal className="h-5 w-5" /></button>
                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute right-0 top-12 z-40 w-52 animate-fade-in rounded-2xl bg-white p-1.5 shadow-float ring-1 ring-slate-200">
                      <button onClick={() => { setMoreMenuOpen(false); setShowCategoryManager(true); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-vihem-ink hover:bg-slate-50">
                        <Tag className="h-4 w-4 text-slate-500" />Hantera kategorier
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <WorkOrderCategoryManagerModal
        open={showCategoryManager}
        onClose={() => setShowCategoryManager(false)}
        organisationId={user?.organisation_id || null}
        userId={user?.id || ''}
      />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 lg:mx-0 lg:px-0">
        {chips.map((chip) => {
          const on = activeChip === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => selectChip(chip.key)}
              aria-pressed={on}
              className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors active:scale-[0.97] ${
                on ? 'bg-vihem-navy text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {chip.label}
              <span className={`rounded-full px-1.5 text-xs ${on ? 'bg-white/20 text-white' : chip.tone === 'danger' && chip.count > 0 ? 'bg-red-50 text-vihem-danger' : 'bg-slate-100 text-slate-500'}`}>{chip.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Sök arbetsordrar..." className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
          aria-label="Filter och sortering"
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 transition-colors ${showFilters ? 'bg-blue-50 text-vihem-blue ring-blue-200' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'}`}
        >
          <SlidersHorizontal className="h-5 w-5" />
          {advancedActive && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-vihem-blue" />}
        </button>
        {isStaff && viewMode === 'list' && (
          <button
            type="button"
            onClick={() => { setSelectMode((v) => !v); setSelectedWorkOrderIds([]); setBulkError(''); }}
            aria-pressed={selectMode}
            className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors ${selectMode ? 'bg-vihem-blue text-white ring-vihem-blue' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
          >
            <ListChecks className="h-5 w-5" /><span className="hidden sm:inline">{selectMode ? 'Klar' : 'Markera flera'}</span>
          </button>
        )}
      </div>

      {showFilters && (
        <Card className="animate-fade-in space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Status"
              options={[{ value: 'all', label: 'Alla statusar' }, ...statusFilterOptions]}
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
                { value: 'mine', label: 'Mina arbetsordrar' },
                { value: 'unassigned', label: 'Ej tilldelade' },
                { value: 'overdue', label: 'Försenade' },
              ]}
              value={filterView}
              onChange={(e) => setFilterView((e.target.value as any) || 'all')}
            />
            <Select
              label="Sortering"
              options={[
                { value: 'due_date', label: 'Förfallodatum' },
                { value: 'updated_at', label: 'Senast uppdaterade' },
                { value: 'priority', label: 'Prioritet' },
                { value: 'created_at', label: 'Nyast först' },
              ]}
              value={sortBy}
              onChange={(e) => setSortBy((e.target.value as WorkOrderSort) || 'due_date')}
            />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setViewMode('list')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border p-2 text-sm font-semibold transition-colors ${viewMode === 'list' ? 'border-blue-200 bg-blue-50 text-vihem-blue' : 'border-slate-200 text-slate-600'}`}>
              <List className="h-4 w-4" />Lista
            </button>
            <button onClick={() => setViewMode('kanban')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border p-2 text-sm font-semibold transition-colors ${viewMode === 'kanban' ? 'border-blue-200 bg-blue-50 text-vihem-blue' : 'border-slate-200 text-slate-600'}`}>
              <LayoutGrid className="h-4 w-4" />Kanban
            </button>
          </div>
        </Card>
      )}

      {/* Content */}
      {loading ? (
        <SkeletonList rows={7} />
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
          {isStaff && selectMode && (
            <div className="sticky top-[4.25rem] z-20 animate-fade-in rounded-2xl bg-vihem-navy p-3 text-white shadow-float lg:top-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="font-bold">{selectedWorkOrderIds.length} markerade</span>
                  <button type="button" onClick={toggleAllVisibleWorkOrders} className="font-semibold text-sky-200 hover:text-white">{allVisibleSelected ? 'Avmarkera alla' : 'Välj alla'}</button>
                  {selectedWorkOrderIds.length > 0 && <button type="button" onClick={() => setSelectedWorkOrderIds([])} className="font-semibold text-sky-200 hover:text-white">Rensa</button>}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={selectedWorkOrderIds.length === 0 || bulkUpdating} onClick={() => bulkUpdateWorkOrders('complete')} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-vihem-success px-3 text-sm font-bold disabled:opacity-40"><CheckCircle2 className="h-4 w-4" />Klar</button>
                  <button type="button" disabled={selectedWorkOrderIds.length === 0 || bulkUpdating} onClick={() => bulkUpdateWorkOrders('archive')} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-sm font-bold disabled:opacity-40"><Archive className="h-4 w-4" />Arkivera</button>
                  <button type="button" disabled={selectedWorkOrderIds.length === 0 || bulkUpdating} onClick={() => bulkUpdateWorkOrders('reopen')} className="flex min-h-10 items-center gap-1.5 rounded-xl bg-white/15 px-3 text-sm font-bold disabled:opacity-40"><RotateCcw className="h-4 w-4" />Ej klar</button>
                </div>
              </div>
              {bulkError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{bulkError}</div>}
            </div>
          )}
          <div className="grid gap-2.5 md:grid-cols-2 lg:hidden">
            {filtered.map((wo) => (
              <WorkOrderCard
                key={wo.id}
                id={wo.id}
                title={wo.title}
                subtitle={wo.property?.name || (wo.customer_project ? `Kundprojekt: ${wo.customer_project.title || wo.customer_project.name}` : '')}
                status={wo.status}
                priority={wo.priority}
                category={wo.category}
                dueDate={wo.due_date}
                overdue={isWorkOrderOverdue(wo)}
                assignees={assigneeList(wo)}
                assigneeIds={wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []}
                selectMode={selectMode}
                selected={selectedWorkOrderIds.includes(wo.id)}
                canAct={isStaff && !ARCHIVED_WO_STATUSES.includes(wo.status)}
                onOpen={() => openWorkOrder(wo)}
                onToggleSelect={() => toggleWorkOrderSelection(wo.id)}
                onComplete={() => completeOne(wo)}
                onChangeDueDate={() => setQuickSheet({ kind: 'due', id: wo.id })}
                onMenu={() => setQuickSheet({ kind: 'actions', id: wo.id })}
              />
            ))}
          </div>

          <Card className="hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {isStaff && selectMode && (
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisibleWorkOrders}
                          className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                          aria-label="Markera alla synliga arbetsordrar"
                        />
                      </th>
                    )}
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
                      className={`border-b border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer ${
                        selectedWorkOrderIds.includes(wo.id) ? 'bg-blue-50/70' : ''
                      }`}
                      onClick={() => {
                        setSelectedWorkOrder(wo);
                        setNewDetailStatus(wo.status);
                        setNewAssignedToIds(wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []);
                        setShowDetailModal(true);
                      }}
                    >
                      {isStaff && selectMode && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedWorkOrderIds.includes(wo.id)}
                            onChange={() => toggleWorkOrderSelection(wo.id)}
                            onClick={(event) => event.stopPropagation()}
                            className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                            aria-label={`Markera ${wo.title}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm font-medium text-vihem-ink"><button type="button" className="min-h-10 text-left hover:text-vihem-blue focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-vihem-blue" onClick={event => { event.stopPropagation(); openWorkOrder(wo); }} aria-label={`Öppna ${wo.title}`}>{wo.title}</button></td>
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
                        {isWorkOrderOverdue(wo) && (
                          <Badge className="ml-1 bg-red-100 text-red-700">Försenad</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {wo.property?.name || '–'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {assigneeNames(wo)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {formatScheduleWindow(wo) || (wo.due_date ? formatDate(wo.due_date) : '–')}
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
                          {formatScheduleWindow(wo) && (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <Clock className="w-3 h-3" />
                              {formatScheduleWindow(wo)}
                            </div>
                          )}
                          {isWorkOrderOverdue(wo) && (
                            <Badge className="bg-red-100 text-red-700">Försenad</Badge>
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
          onClose={closeCreateModal}
          title="Ny arbetsorder"
          size="lg"
          footer={<div className="flex items-center justify-between gap-3"><span className="text-sm text-vihem-muted" role="status">{createError ? 'Kunde inte spara' : createDirty ? 'Osparat utkast' : 'Titel är obligatorisk'}</span><div className="flex shrink-0 gap-2"><Button variant="secondary" onClick={closeCreateModal} disabled={submittingCreate}>Avbryt</Button><Button className="whitespace-nowrap" onClick={createWorkOrder} loading={submittingCreate} disabled={!createForm.title.trim()}>{createdFromChat.current ? 'Försök kopiera bilagan igen' : 'Skapa arbetsorder'}</Button></div></div>}
        >
          <fieldset disabled={submittingCreate} aria-label="Arbetsorderuppgifter" className="min-w-0 space-y-6">
            {createError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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

            <section aria-label="Planering" className="space-y-3"><h3 className="font-semibold text-vihem-ink">Planering</h3><div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Kategori"
              options={categoryOptions}
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

            </div></section>
            <section aria-label="Plats och datum" className="space-y-3"><h3 className="font-semibold text-vihem-ink">Plats och datum</h3><div className="grid gap-4 sm:grid-cols-2">
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
            </div></section>

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
                    <Avatar name={staff.name} userId={staff.id} size="sm"/><span>{staff.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">Första valda person blir primärt ansvarig, men alla valda visas som tilldelade.</p>
            </div>

            <details className="group space-y-3 border-t border-vihem-border pt-4"><summary className="cursor-pointer font-semibold text-vihem-ink">Checklista <span className="text-sm font-normal text-vihem-muted">· valfritt</span></summary>
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
                      aria-label={`Checklistepunkt ${index + 1}`}
                      value={item}
                      onChange={(event) => updateChecklistItem(index, event.target.value)}
                      placeholder="Ex. Kontrollera lås, dokumentera före/efter..."
                    />
                    {createForm.checklist.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeChecklistItem(index)}
                        aria-label={`Ta bort checklistepunkt ${index + 1}`}
                        className="vihem-icon-button text-vihem-muted"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Bilder/filer</p>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600 hover:bg-slate-100">
                <Paperclip className="mb-2 h-5 w-5 text-slate-400" />
                Välj bilder eller filer att bifoga
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => { const chosen = Array.from(event.target.files || []); setCreateForm(current => ({ ...current, files: [...current.files, ...chosen] })); event.target.value = ""; }}
                />
              </label>
              {chatSourceFile&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeChatFile} disabled={!!createdFromChat.current} onChange={e=>setIncludeChatFile(e.target.checked)}/>Kopiera {chatSourceFile.name} från chatten till arbetsordern (privat bilaga)</label>}
              {createForm.files.length > 0 && (
                <div className="space-y-1">
                  {createForm.files.map((file, index) => (
                    <div key={`${file.name}-${file.size}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <Paperclip className="h-3.5 w-3.5" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setCreateForm({
                          ...createForm,
                          files: createForm.files.filter((_, fileIndex) => fileIndex !== index),
                        })}
                        className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600"
                        aria-label={`Ta bort ${file.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>


          </fieldset>
        </Modal>
      )}

      {/* Edit Modal -- title/description/category/priority/property/
          apartment/tenant/due date. Status and assignment keep their own
          existing dedicated controls in the detail view below. */}
      {isStaff && selectedWorkOrder && (
        <Modal
          open={showEditModal}
          onClose={closeEditModal}
          title="Redigera arbetsorder"
          size="lg"
          footer={<div className="flex items-center justify-between gap-3"><span className="text-sm text-vihem-muted" role="status">{editError ? 'Kunde inte spara' : editDirty ? 'Osparade ändringar' : 'Alla ändringar sparade'}</span><div className="flex shrink-0 gap-2"><Button variant="secondary" onClick={closeEditModal} disabled={submittingEdit}>Avbryt</Button><Button onClick={updateWorkOrderDetails} loading={submittingEdit} disabled={!editForm.title.trim() || !editDirty}>Spara</Button></div></div>}
        >
          <fieldset disabled={submittingEdit} aria-label="Arbetsorderuppgifter" className="min-w-0 space-y-6">
            {editError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {editError}
              </div>
            )}
            <Input
              label="Titel *"
              required
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            />

            <Textarea
              label="Beskrivning"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={4}
            />

            <section aria-label="Planering" className="space-y-3"><h3 className="font-semibold text-vihem-ink">Planering</h3><div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Kategori"
              options={categoryOptions}
              value={editForm.category}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
            />

            <Select
              label="Prioritet"
              options={[
                { value: 'low', label: WO_PRIORITY_LABELS.low },
                { value: 'normal', label: WO_PRIORITY_LABELS.normal },
                { value: 'high', label: WO_PRIORITY_LABELS.high },
                { value: 'urgent', label: WO_PRIORITY_LABELS.urgent },
              ]}
              value={editForm.priority}
              onChange={(e) => setEditForm({ ...editForm, priority: e.target.value as WOPriority })}
            />

            </div></section>
            <section aria-label="Plats och datum" className="space-y-3"><h3 className="font-semibold text-vihem-ink">Plats och datum</h3><div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Fastighet"
              options={[{ value: '', label: '- Ingen -' }, ...properties.map((p) => ({ value: p.id, label: p.name }))]}
              value={editForm.property_id}
              onChange={(e) => setEditForm({ ...editForm, property_id: e.target.value, apartment_id: '' })}
            />

            <Select
              label="Lägenhet"
              options={[
                { value: '', label: '- Ingen -' },
                ...editPropertyApartments.map((apt) => ({
                  value: apt.id,
                  label: `${apt.apartment_number}${apt.property?.name ? ` · ${apt.property.name}` : ''}`,
                })),
              ]}
              value={editForm.apartment_id}
              onChange={(e) => setEditForm({ ...editForm, apartment_id: e.target.value })}
            />

            <Select
              label="Hyresgäst"
              options={[{ value: '', label: '- Ingen -' }, ...tenants.map((tenant) => ({ value: tenant.id, label: tenant.name }))]}
              value={editForm.tenant_id}
              onChange={(e) => setEditForm({ ...editForm, tenant_id: e.target.value })}
            />

            <Input
              label="Förfallodatum"
              type="date"
              value={editForm.due_date}
              onChange={(e) => setEditForm({ ...editForm, due_date: e.target.value })}
            />
            </div></section>


          </fieldset>
        </Modal>
      )}

      <Modal open={!!discardForm} onClose={() => setDiscardForm(null)} title="Kasta osparade ändringar?" size="sm" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDiscardForm(null)}>Fortsätt redigera</Button><Button variant="danger" onClick={() => discardForm === 'create' ? finishCloseCreate() : finishCloseEdit()}>Kasta ändringar</Button></div>}><p className="text-sm text-vihem-muted">Uppgifterna i formuläret har inte sparats. Fortsätt redigera för att behålla dem.</p></Modal>

      {/* Detail Modal */}
      <Modal
        open={showDetailModal}
        onClose={requestCloseDetail}
        title={selectedWorkOrder?.title || 'Arbetsorder'}
        size="xl"
        toolbar={selectedWorkOrder && <div className="space-y-3">
            {isStaff && (
              <div className="flex justify-end gap-2">
                <ContextChatLauncher type="workorder" id={selectedWorkOrder.id} name={selectedWorkOrder.title} suggestedIds={selectedWorkOrder.assigned_to_ids || []} onNavigate={_onNavigate} />
                <Button variant="secondary" size="sm" onClick={openEditModal} disabled={detailDirty || savingClose}>
                  Redigera arbetsorder
                </Button>
              </div>
            )}
          <Tabs active={detailTab} onChange={(key) => setDetailTab(key as typeof detailTab)} tabs={[
            {key:'overview',label:'Översikt'},
            {key:'comments',label:`Kommentarer${comments.length ? ` (${comments.length})` : ''}`},
            ...(isStaff ? [{key:'time',label:'Tid'},{key:'history',label:'Historik'}] : []),
          ]}/>
        </div>}
        footer={detailDirty && <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-vihem-muted" role="status">Osparade ändringar</p>
          <Button onClick={saveAndCloseDetail} loading={savingClose} disabled={updatingStatus || updatingAssignment}>Spara och stäng</Button>
        </div>}
      >
        {selectedWorkOrder && (
          <div className="space-y-6">
            {detailTab === 'overview' && (
              <div className="space-y-6">
            {selectedWorkOrder.description && (
              <div>
                <p className="text-sm font-semibold text-vihem-ink mb-2">Beskrivning</p>
                <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap max-w-prose">{selectedWorkOrder.description}</p>
              </div>
            )}

            {/* Work order info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-vihem-muted">Kategori</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.category}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-vihem-muted">Prioritet</p>
                <Badge className={getWOPriorityColor(selectedWorkOrder.priority)}>
                  {WO_PRIORITY_LABELS[selectedWorkOrder.priority]}
                </Badge>
              </div>

              <div>
                <p className="text-xs font-medium text-vihem-muted">Status</p>
                {isStaff ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Select
                      aria-label="Arbetsorderns status"
                      options={WO_STATUSES.map((s) => ({ value: s, label: WO_STATUS_LABELS[s] }))}
                      value={newDetailStatus}
                      onChange={(e) => setNewDetailStatus(e.target.value as WOStatus)}
                      className="text-sm"
                    />
                  </div>
                ) : (
                  <Badge className={getWOStatusColor(selectedWorkOrder.status)}>
                    {WO_STATUS_LABELS[selectedWorkOrder.status]}
                  </Badge>
                )}
                {selectedWorkOrder.maintenance_request && (
                  <p className="mt-2 text-xs font-medium text-blue-700">
                    Synkas till kunden via den kopplade felanmälan
                  </p>
                )}
              </div>

              {selectedWorkOrder.maintenance_request && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 md:col-span-2">
                  <p className="text-xs font-semibold uppercase text-blue-700">Kopplad felanmälan</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">{selectedWorkOrder.maintenance_request.title}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Kundstatus: {selectedWorkOrder.maintenance_request.status === 'waiting_material' ? 'Inväntar material' : selectedWorkOrder.maintenance_request.status === 'waiting_contractor' ? 'Inväntar entreprenör' : selectedWorkOrder.maintenance_request.status === 'done' ? 'Klar' : selectedWorkOrder.maintenance_request.status === 'closed' ? 'Stängd' : selectedWorkOrder.maintenance_request.status === 'started' ? 'Pågår' : 'Mottagen'}
                  </p>
                </div>
              )}

              {selectedWorkOrder.property && (
              <div>
                <p className="text-xs font-medium text-vihem-muted">Fastighet</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <Building2 className="w-4 h-4" />
                  {selectedWorkOrder.property?.name || '–'}
                </div>
              </div>
              )}

              {selectedWorkOrder.apartment && (
              <div>
                <p className="text-xs font-medium text-vihem-muted">Lägenhet</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.apartment?.apartment_number || '–'}</p>
              </div>
              )}

              {selectedWorkOrder.tenant && (
              <div>
                <p className="text-xs font-medium text-vihem-muted">Hyresgäst</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.tenant?.name || '–'}</p>
              </div>
              )}

              <div>
                <p className="text-xs font-medium text-vihem-muted">Förfallodatum</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <Calendar className="w-4 h-4" />
                  {selectedWorkOrder.due_date ? formatDate(selectedWorkOrder.due_date) : '–'}
                </div>
              </div>

              {formatScheduleWindow(selectedWorkOrder) && (
                <div>
                  <p className="text-xs font-medium text-vihem-muted">Planerad tid</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800 mt-1">
                    <Clock className="w-4 h-4" />
                    {formatScheduleWindow(selectedWorkOrder)}
                    {isWorkOrderOverdue(selectedWorkOrder) && (
                      <Badge className="bg-red-100 text-red-700">Försenad</Badge>
                    )}
                  </div>
                </div>
              )}

              {isStaff && (
                <div className="md:col-span-2">
                  <details className="rounded-xl bg-slate-50 px-3 py-2">
                    <summary className="vihem-touch-target flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-vihem-ink">
                      <span>Ansvariga</span><span className="text-vihem-muted">{newAssignedToIds.length ? newAssignedToIds.map(assigneeName).join(', ') : 'Välj personal'}</span>
                    </summary>
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
                          <Avatar name={staff.name} userId={staff.id} size="sm"/><span>{staff.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  </details>
                </div>
              )}

              {!isStaff && <div>
                <p className="text-xs font-medium text-vihem-muted">Tilldelad</p>
                <div className="flex items-center gap-2 text-sm text-slate-800 mt-1">
                  <User className="w-4 h-4" />
                  {assigneeNames(selectedWorkOrder)}
                </div>
              </div>}
            </div>

            <details className="text-sm text-vihem-muted">
              <summary className="vihem-touch-target cursor-pointer font-medium">Om arbetsordern</summary>
              <div className="grid gap-3 py-2 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-vihem-muted">Skapad av</p>
                <p className="text-sm text-slate-800">{selectedWorkOrder.creator?.name || '–'}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-vihem-muted">Skapad</p>
                <p className="text-sm text-slate-800">{formatDateTime(selectedWorkOrder.created_at)}</p>
              </div>

              </div>
            </details>
            {isStaff && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-slate-500">Checklista</p>
                <div className="space-y-2">
                  {selectedWorkOrder.checklist?.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <button type="button" onClick={() => toggleChecklistItem(item.id)} disabled={savingChecklist} aria-label={`${item.done ? 'Markera som ogjord' : 'Markera som klar'}: ${item.text}`} aria-pressed={item.done} className="vihem-icon-button flex-shrink-0">
                        <CheckSquare className={`h-4 w-4 ${item.done ? 'text-green-600' : 'text-slate-400'}`} />
                      </button>
                      <span className={`flex-1 ${item.done ? 'text-slate-400 line-through' : ''}`}>{item.text}</span>
                      <button
                        type="button"
                        onClick={() => removeSavedChecklistItem(item.id)}
                        disabled={savingChecklist}
                        aria-label={`Ta bort checklistepunkt: ${item.text}`}
                        className="vihem-icon-button flex-shrink-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {!selectedWorkOrder.checklist?.length && (
                    <p className="text-sm text-slate-400">Ingen checklista ännu.</p>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={newChecklistItemText}
                    onChange={(e) => setNewChecklistItemText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                    placeholder="Lägg till en rad..."
                    className="flex-1"
                  />
                  <Button variant="secondary" size="sm" onClick={addChecklistItem} loading={savingChecklist} disabled={!newChecklistItemText.trim()}>
                    <Plus className="h-4 w-4" /> Lägg till
                  </Button>
                </div>
              </div>
            )}

            {selectedWorkOrder.attachments?.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase text-slate-500">Bilagor</p>
                <div className="space-y-2">
                  {selectedWorkOrder.attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 flex-1 items-center gap-2 text-blue-700 hover:text-blue-800"
                      >
                        <Paperclip className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{attachment.name}</span>
                      </a>
                      {isStaff && (
                        <button
                          type="button"
                          onClick={() => deleteWorkOrderAttachment(attachment)}
                          disabled={deletingAttachmentId === attachment.id}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deletingAttachmentId === attachment.id ? 'Tar bort...' : 'Ta bort'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <WorkOrderChatFiles workOrderId={selectedWorkOrder.id}/>
            <WorkOrderOperationsPanel
              workOrderId={selectedWorkOrder.id}
              propertyId={selectedWorkOrder.property_id}
              apartmentId={selectedWorkOrder.apartment_id}
              category={selectedWorkOrder.category}
            />

            {/* Time logged */}
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
              <Clock className="w-4 h-4 text-slate-600" />
              <div>
                <p className="text-xs font-medium text-slate-500">Tid loggad</p>
                <p className="text-sm font-medium text-slate-800">{formatMinutes(totalTimeLogged)}</p>
              </div>
            </div>

              </div>
            )}

            {detailTab === 'comments' && (
            <div className="space-y-4">
              {loadingComments ? (
                <p className="text-sm text-vihem-muted">Laddar kommentarer...</p>
              ) : comments.length === 0 ? (
                <p className="rounded-2xl bg-slate-50 px-4 py-6 text-center text-sm text-vihem-muted">Inga kommentarer ännu</p>
              ) : (
                <div className="space-y-2.5">
                  {comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`rounded-2xl px-3.5 py-3 text-sm ${
                        comment.internal ? 'border border-dashed border-amber-300 bg-amber-50' : 'bg-blue-50/70'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2"><Avatar name={comment.user?.name} userId={comment.user_id} size="xs"/><p className="truncate font-semibold text-vihem-ink">{comment.user?.name || 'Okänd'}</p></div>
                        {comment.internal ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800"><Lock className="h-3 w-3" />Intern anteckning</span>
                        ) : (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">Synlig för kund</span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-slate-700">{comment.comment}</p>
                      <p className="mt-1 text-xs text-vihem-muted">{formatDateTime(comment.created_at)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3 rounded-2xl bg-white p-3 ring-1 ring-slate-200">
                {isStaff && <CommentModeToggle mode={commentInternal ? 'internal' : 'customer'} onChange={(m) => setCommentInternal(m === 'internal')} />}
                <Textarea
                  label={commentInternal ? 'Intern anteckning' : 'Meddelande till kund'}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={commentInternal ? 'Skriv intern anteckning...' : 'Skriv ett meddelande...'}
                  rows={3}
                />
                {commentError && <p role="alert" className="text-sm text-vihem-danger">{commentError}</p>}
                <Button onClick={addComment} loading={postingComment} disabled={!commentText.trim()} className="w-full">
                  {commentInternal ? 'Spara intern anteckning' : 'Skicka meddelande'}
                </Button>
              </div>
            </div>
            )}

            {isStaff && detailTab === 'time' && (
              <div className="space-y-4">
            {/* Time logged */}
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
              <Clock className="w-4 h-4 text-slate-600" />
              <div>
                <p className="text-xs font-medium text-slate-500">Tid loggad</p>
                <p className="text-sm font-medium text-slate-800">{formatMinutes(totalTimeLogged)}</p>
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
                  <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm text-amber-800">Du har en pågående tidrapport: <span className="font-semibold">{openEntryLabel}</span></p>
                    <Button variant="secondary" className="w-full gap-2" onClick={() => setQuickSheet({ kind: 'switch', id: selectedWorkOrder.id })}>
                      <Repeat className="h-4 w-4" />
                      Byt till detta jobb
                    </Button>
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

            {isStaff && detailTab === 'history' && (
            <div className="space-y-2">
              {loadingHistory ? (
                <p className="text-sm text-vihem-muted">Laddar historik...</p>
              ) : (
                <>
                  {history.map((h) => {
                    const m = h.metadata || {};
                    const who = h.actor_id ? assigneeName(h.actor_id) : 'System';
                    const text = h.event_type === 'work_order_status_changed'
                      ? `Status: ${WO_STATUS_LABELS[m.from as WOStatus] || m.from} → ${WO_STATUS_LABELS[m.to as WOStatus] || m.to}`
                      : h.event_type === 'work_order_due_date_changed'
                        ? `Förfallodatum: ${m.from ? formatDate(m.from) : 'inget'} → ${m.to ? formatDate(m.to) : 'inget'}`
                        : h.event_type === 'work_order_priority_changed'
                          ? `Prioritet: ${WO_PRIORITY_LABELS[m.from as WOPriority] || m.from} → ${WO_PRIORITY_LABELS[m.to as WOPriority] || m.to}`
                          : h.event_type === 'work_order_assignment_changed'
                            ? `Tilldelning: ${((m.from as string[]) || []).map(assigneeName).join(', ') || 'ingen'} → ${((m.to as string[]) || []).map(assigneeName).join(', ') || 'ingen'}`
                            : h.event_type;
                    return (
                      <div key={h.id} className="flex gap-3 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-sm">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-vihem-blue" />
                        <div className="min-w-0">
                          <p className="font-medium text-vihem-ink">{text}</p>
                          <p className="text-xs text-vihem-muted">{who} · {formatDateTime(h.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex gap-3 rounded-2xl bg-slate-50 px-3.5 py-2.5 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                    <div className="min-w-0">
                      <p className="font-medium text-vihem-ink">Arbetsordern skapades</p>
                      <p className="text-xs text-vihem-muted">{selectedWorkOrder.creator?.name || 'Okänd'} · {formatDateTime(selectedWorkOrder.created_at)}</p>
                    </div>
                  </div>
                  {history.length === 0 && <p className="px-1 text-xs text-vihem-muted">Ändringar av status, förfallodatum, prioritet och tilldelning loggas härifrån och framåt.</p>}
                </>
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
              options={timeCategories.length > 0 ? timeCategories.map(c => ({ value: c.key, label: c.label })) : Object.entries(TIME_CATEGORY_LABELS).map(([k, v]) => ({ value: k, label: v }))}
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
      <Modal open={confirmCloseOpen} onClose={() => setConfirmCloseOpen(false)} title="Spara ändringar?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-vihem-muted">
            Du har ändrat {[statusDirty ? 'status' : '', assignmentDirty ? 'tilldelning' : ''].filter(Boolean).join(' och ')} men inte sparat. Vill du spara ändringarna innan du stänger?
          </p>
          <div className="space-y-2">
            <Button className="w-full" onClick={saveAndCloseDetail} loading={savingClose}>Spara ändringar</Button>
            <Button variant="secondary" className="w-full" onClick={discardAndCloseDetail} disabled={savingClose}>Stäng utan att spara</Button>
            <Button variant="ghost" className="w-full" onClick={() => setConfirmCloseOpen(false)} disabled={savingClose}>Fortsätt redigera</Button>
          </div>
        </div>
      </Modal>

      {isStaff && sheetWo && (
        <>
          <WorkOrderActionSheet open={quickSheet?.kind === 'actions'} onClose={() => setQuickSheet(null)} title={sheetWo.title} actions={actionsFor(sheetWo)} />
          <DueDateSheet open={quickSheet?.kind === 'due'} onClose={() => setQuickSheet(null)} current={sheetWo.due_date} saving={sheetBusy} onPick={(date) => changeDueDateFor(sheetWo.id, date)} />
          <AssigneeSheet
            open={quickSheet?.kind === 'assignee'}
            onClose={() => setQuickSheet(null)}
            staff={staffMembers.map((m) => ({ id: m.id, name: m.name }))}
            currentIds={sheetWo.assigned_to_ids?.length ? sheetWo.assigned_to_ids : sheetWo.assigned_to ? [sheetWo.assigned_to] : []}
            saving={sheetBusy}
            onSave={(ids) => changeAssigneesFor(sheetWo.id, ids)}
          />
          <CommentSheet open={quickSheet?.kind === 'comment'} onClose={() => setQuickSheet(null)} saving={sheetBusy} onSubmit={(text, internal) => addCommentTo(sheetWo.id, text, internal)} />
          {openEntry && (
            <SwitchJobSheet
              open={quickSheet?.kind === 'switch'}
              onClose={() => setQuickSheet(null)}
              currentLabel={openEntryLabel}
              currentSince={openEntry.start_time}
              targetTitle={sheetWo.title}
              busy={sheetBusy}
              onConfirm={() => startOrSwitchTo(sheetWo)}
            />
          )}
        </>
      )}
    </div>
  );
}
