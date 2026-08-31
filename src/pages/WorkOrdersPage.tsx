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
} from 'lucide-react';
import { TIME_CATEGORY_LABELS } from '../lib/utils';
import { archiveFileInGoogleDrive } from '../lib/googleDriveStorage';
import type { TimeCategory } from '../types';

type FilterView = 'all' | 'mine' | 'unassigned';
type WorkOrderListTab = 'active' | 'archived';
type WorkOrderSort = 'due_date' | 'created_at';

type WorkOrderPerson = Pick<Profile, 'name'>;

interface WOWithRelations extends Omit<WorkOrder, 'property' | 'apartment' | 'tenant' | 'assigned' | 'creator'> {
  property?: Pick<Property, 'name' | 'address'>;
  apartment?: { apartment_number: string };
  tenant?: WorkOrderPerson;
  assigned?: WorkOrderPerson;
  creator?: WorkOrderPerson;
  maintenance_request?: { id: string; title: string; status: string; tenant_id: string } | null;
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

export function WorkOrdersPage({ onNavigate: _onNavigate, initialWorkOrderId }: { onNavigate: (page: string) => void; initialWorkOrderId?: string }) {
  const { user, loading: authLoading } = useAuth();
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

  // Create form state
  const [createForm, setCreateForm] = useState<CreateWorkOrderForm>(defaultCreateForm);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState('');

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

  useEffect(() => {
    if (!initialWorkOrderId || loading || workOrders.length === 0) return;
    const workOrder = workOrders.find((order) => order.id === initialWorkOrderId);
    if (workOrder) {
      setSelectedWorkOrder(workOrder);
      setNewDetailStatus(workOrder.status);
      setNewAssignedToIds(workOrder.assigned_to_ids?.length ? workOrder.assigned_to_ids : workOrder.assigned_to ? [workOrder.assigned_to] : []);
      setShowDetailModal(true);
    }
  }, [initialWorkOrderId, loading, workOrders]);

  // Fetch comments when detail modal opens
  useEffect(() => {
    if (showDetailModal && selectedWorkOrder) {
      fetchComments();
      fetchTimeLogged();
      if (isStaff) checkActiveTimeEntry();
    }
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
          maintenance_request:vihem_maintenance_requests(id,title,status,tenant_id)`
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

  async function createWorkOrder() {
    if (!user || !createForm.title) return;

    try {
      setSubmittingCreate(true);
      setCreateError('');
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
    if (!user || !selectedWorkOrder || !commentText.trim()) return;

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
      setCommentInternal(false);
      await fetchComments();
    } catch (err) {
      console.error('Error posting comment:', err);
    } finally {
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
      setSelectedWorkOrder({ ...selectedWorkOrder, status: newDetailStatus });
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating status:', err);
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
      setSelectedWorkOrder({ ...selectedWorkOrder, assigned_to: assignedIds[0] || null, assigned_to_ids: assignedIds });
      await fetchWorkOrders();
    } catch (err) {
      console.error('Error updating assignment:', err);
    } finally {
      setUpdatingAssignment(false);
    }
  }

  function openEditModal() {
    if (!selectedWorkOrder) return;
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

  function closeEditModal() {
    setShowEditModal(false);
    setEditError('');
    setShowDetailModal(true);
  }

  async function updateWorkOrderDetails() {
    if (!selectedWorkOrder || !editForm.title.trim()) return;

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
      await fetchWorkOrders();
    } catch (err: any) {
      console.error('Error updating work order:', err);
      setEditError(err.message || 'Kunde inte spara ändringarna. Kontrollera fälten och försök igen.');
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function checkActiveTimeEntry() {
    if (!user) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('vihem_time_entries')
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
      const { error } = await supabase.from('vihem_time_entries').insert({
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
              { value: 'mine', label: 'Mina arbetsordrar' },
              { value: 'unassigned', label: 'Ej tilldelade arbetsordrar' },
            ]}
            value={filterView}
            onChange={(e) => setFilterView((e.target.value as any) || 'all')}
            className="hidden md:block"
          />

          <Select
            options={[
              { value: 'due_date', label: 'Sortera: förfallodag' },
              { value: 'created_at', label: 'Sortera: senast skapade' },
            ]}
            value={sortBy}
            onChange={(e) => setSortBy((e.target.value as WorkOrderSort) || 'due_date')}
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
              { value: 'mine', label: 'Mina arbetsordrar' },
              { value: 'unassigned', label: 'Ej tilldelade arbetsordrar' },
            ]}
            value={filterView}
            onChange={(e) => setFilterView((e.target.value as any) || 'all')}
          />

          <Select
            label="Sortering"
            options={[
              { value: 'due_date', label: 'Förfallodag' },
              { value: 'created_at', label: 'Senast skapade' },
            ]}
            value={sortBy}
            onChange={(e) => setSortBy((e.target.value as WorkOrderSort) || 'due_date')}
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
          {isStaff && (
            <Card className="p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisibleWorkOrders}
                      className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                    />
                    Välj alla synliga
                  </label>
                  <span className="text-sm text-slate-500">
                    {selectedWorkOrderIds.length} markerade
                  </span>
                  {selectedWorkOrderIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedWorkOrderIds([])}
                      className="text-sm font-medium text-slate-500 hover:text-slate-800"
                    >
                      Rensa val
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => bulkUpdateWorkOrders('complete')}
                    loading={bulkUpdating}
                    disabled={selectedWorkOrderIds.length === 0}
                    className="gap-1"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Klarmarkera
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => bulkUpdateWorkOrders('archive')}
                    loading={bulkUpdating}
                    disabled={selectedWorkOrderIds.length === 0}
                    className="gap-1"
                  >
                    <Archive className="h-4 w-4" />
                    Arkivera
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => bulkUpdateWorkOrders('reopen')}
                    loading={bulkUpdating}
                    disabled={selectedWorkOrderIds.length === 0}
                    className="gap-1"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Markera som ej klar
                  </Button>
                </div>
              </div>
              {bulkError && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {bulkError}
                </div>
              )}
            </Card>
          )}
          <div className="grid gap-3 md:hidden">
            {filtered.map((wo) => (
              <Card
                key={wo.id}
                className={`p-4 cursor-pointer hover:shadow-md transition-all ${
                  selectedWorkOrderIds.includes(wo.id) ? 'ring-2 ring-blue-500 ring-offset-1' : ''
                }`}
                onClick={() => {
                  setSelectedWorkOrder(wo);
                  setNewDetailStatus(wo.status);
                  setNewAssignedToIds(wo.assigned_to_ids?.length ? wo.assigned_to_ids : wo.assigned_to ? [wo.assigned_to] : []);
                  setShowDetailModal(true);
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  {isStaff && (
                    <input
                      type="checkbox"
                      checked={selectedWorkOrderIds.includes(wo.id)}
                      onChange={() => toggleWorkOrderSelection(wo.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="mt-1 h-4 w-4 rounded border-slate-300 accent-blue-600"
                      aria-label={`Markera ${wo.title}`}
                    />
                  )}
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
                  {isWorkOrderOverdue(wo) && (
                    <Badge className="bg-red-100 text-red-700">Försenad</Badge>
                  )}
                </div>

                <div className="mt-4 grid gap-2 text-sm text-slate-600">
                  {formatScheduleWindow(wo) && (
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="truncate">{formatScheduleWindow(wo)}</span>
                    </div>
                  )}
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
                    {isStaff && (
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
                      {isStaff && (
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

      {/* Edit Modal -- title/description/category/priority/property/
          apartment/tenant/due date. Status and assignment keep their own
          existing dedicated controls in the detail view below. */}
      {isStaff && selectedWorkOrder && (
        <Modal
          open={showEditModal}
          onClose={closeEditModal}
          title="Redigera arbetsorder"
          size="lg"
        >
          <div className="space-y-4">
            {editError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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

            <Select
              label="Kategori"
              options={WO_CATEGORIES.map((cat) => ({ value: cat, label: cat }))}
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

            <div className="flex gap-2 pt-4">
              <Button
                variant="secondary"
                onClick={closeEditModal}
              >
                Avbryt
              </Button>
              <Button
                onClick={updateWorkOrderDetails}
                loading={submittingEdit}
                disabled={!editForm.title.trim()}
              >
                Spara ändringar
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
            {isStaff && (
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={openEditModal}>
                  Redigera arbetsorder
                </Button>
              </div>
            )}
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

              {formatScheduleWindow(selectedWorkOrder) && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Planerad tid</p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-slate-800 mt-1">
                    <Clock className="w-4 h-4" />
                    {formatScheduleWindow(selectedWorkOrder)}
                    {isWorkOrderOverdue(selectedWorkOrder) && (
                      <Badge className="bg-red-100 text-red-700">Försenad</Badge>
                    )}
                  </div>
                </div>
              )}

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
                  placeholder={commentInternal ? 'Skriv intern kommentar...' : 'Skriv kommentar som kunden kan se...'}
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
                    Intern kommentar (annars syns kommentaren för kunden)
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
