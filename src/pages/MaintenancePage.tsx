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
  formatDateTime,
  MR_STATUS_LABELS,
  getMRStatusColor,
  getMRPriorityColor,
  MR_PRIORITY_LABELS,
  MR_CATEGORY_LABELS,
  WO_CATEGORIES,
  WO_PRIORITY_LABELS,
  TIME_CATEGORY_LABELS,
} from '../lib/utils';
import type {
  MaintenanceRequest,
  MaintenanceRequestComment,
  MRCategory,
  MRPriority,
  MRStatus,
  Profile,
  TimeCategory,
} from '../types';
import {
  Plus,
  Wrench,
  MessageSquare,
  Clock,
  User,
  Filter,
  ChevronDown,
  Play,
  Square,
  ClipboardList,
} from 'lucide-react';

type FilterStatus = 'all' | MRStatus;
type FilterCategory = 'all' | MRCategory;
type FilterPriority = 'all' | MRPriority;

interface MRWithRelations extends MaintenanceRequest {
  tenant?: Profile;
  property?: { name: string };
  apartment?: { apartment_number: string };
  assigned?: Profile;
}

export function MaintenancePage({ onNavigate: _onNavigate }: { onNavigate: (page: string) => void }) {
  const { user, loading: authLoading } = useAuth();
  const [requests, setRequests] = useState<MRWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterCategory, setFilterCategory] = useState<FilterCategory>('all');
  const [filterPriority, setFilterPriority] = useState<FilterPriority>('all');
  const [selectedRequest, setSelectedRequest] = useState<MRWithRelations | null>(
    null
  );
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [comments, setComments] = useState<MaintenanceRequestComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // New request form state
  const [newRequestForm, setNewRequestForm] = useState({
    title: '',
    category: 'other' as MRCategory,
    description: '',
    priority: 'normal' as MRPriority,
    access_permission: false,
    preferred_times: '',
    contact_phone: '',
  });
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Staff-specific state
  const [staffMembers, setStaffMembers] = useState<Profile[]>([]);
  const [internalNotes, setInternalNotes] = useState('');
  const [newStatus, setNewStatus] = useState<MRStatus | ''>('');
  const [assignedTo, setAssignedTo] = useState<string | ''>('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingAssignment, setUpdatingAssignment] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Work order creation from maintenance request
  const [showCreateWOModal, setShowCreateWOModal] = useState(false);
  const [woForm, setWoForm] = useState({ title: '', description: '', category: WO_CATEGORIES[0], priority: 'normal', assigned_to: '' });
  const [creatingWO, setCreatingWO] = useState(false);

  // Stamp-in on maintenance request
  const [showStampModal, setShowStampModal] = useState(false);
  const [stampCategory, setStampCategory] = useState<TimeCategory>('maintenance');
  const [stampComment, setStampComment] = useState('');
  const [stampingIn, setStampingIn] = useState(false);
  const [activeEntry, setActiveEntry] = useState<{ id: string; maintenance_request_id: string | null } | null>(null);

  const isTenant = user?.role === 'tenant';
  const isStaff = user?.role === 'staff' || user?.role === 'admin';

  // Fetch maintenance requests
  useEffect(() => {
    if (!authLoading && user) {
      fetchRequests();
    }
  }, [authLoading, user]);

  // Fetch staff members for assignment
  useEffect(() => {
    if (isStaff) {
      fetchStaffMembers();
    }
  }, [isStaff]);

  // Fetch comments when request is selected
  useEffect(() => {
    if (selectedRequest && showDetailModal) {
      fetchComments(selectedRequest.id);
      setInternalNotes(selectedRequest.internal_notes || '');
      setNewStatus(selectedRequest.status);
      setAssignedTo(selectedRequest.assigned_to || '');
      if (isStaff) checkActiveEntry();
    }
  }, [selectedRequest, showDetailModal]);

  async function fetchRequests() {
    try {
      setLoading(true);
      let query = supabase.from('maintenance_requests').select(
        `
        id,
        tenant_id,
        property_id,
        apartment_id,
        title,
        description,
        category,
        priority,
        status,
        access_permission,
        preferred_times,
        contact_info,
        assigned_to,
        internal_notes,
        created_at,
        updated_at,
        tenant:profiles!tenant_id(id, name, email, phone, role),
        property:properties(id, name, address),
        apartment:apartments(id, apartment_number),
        assigned:profiles!assigned_to(id, name, email, phone, role)
      `
      );

      if (isTenant && user) {
        query = query.eq('tenant_id', user.id);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;
      setRequests(data || []);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchStaffMembers() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, phone, role')
        .in('role', ['staff', 'admin'])
        .eq('active', true);

      if (error) throw error;
      setStaffMembers(data || []);
    } catch (err) {
      console.error('Error fetching staff members:', err);
    }
  }

  async function fetchComments(requestId: string) {
    try {
      setLoadingComments(true);
      const { data, error } = await supabase
        .from('maintenance_request_comments')
        .select(
          `
        id,
        request_id,
        user_id,
        comment,
        internal,
        created_at,
        user:profiles(id, name, email, phone, role)
      `
        )
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Filter internal comments for tenants
      if (isTenant) {
        setComments((data || []).filter(c => !c.internal));
      } else {
        setComments(data || []);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    try {
      setSubmittingRequest(true);
      const { data, error } = await supabase
        .from('maintenance_requests')
        .insert([
          {
            tenant_id: user.id,
            property_id: null, // Will be fetched from tenant's tenancy
            apartment_id: null,
            title: newRequestForm.title,
            description: newRequestForm.description,
            category: newRequestForm.category,
            priority: newRequestForm.priority,
            status: 'received',
            access_permission: newRequestForm.access_permission,
            preferred_times: newRequestForm.preferred_times,
            contact_info: {
              phone: newRequestForm.contact_phone,
            },
            internal_notes: '',
          },
        ])
        .select();

      if (error) throw error;

      // Reset form and close modal
      setNewRequestForm({
        title: '',
        category: 'other',
        description: '',
        priority: 'normal',
        access_permission: false,
        preferred_times: '',
        contact_phone: '',
      });
      setShowNewRequestModal(false);

      // Refresh requests
      await fetchRequests();
    } catch (err) {
      console.error('Error creating request:', err);
      alert('Kunde inte skapa felanmälan. Försök igen senare.');
    } finally {
      setSubmittingRequest(false);
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRequest || !user || !commentText.trim()) return;

    try {
      setPostingComment(true);
      const { error } = await supabase
        .from('maintenance_request_comments')
        .insert([
          {
            request_id: selectedRequest.id,
            user_id: user.id,
            comment: commentText,
            internal: isStaff && isTenant === false,
          },
        ]);

      if (error) throw error;

      setCommentText('');
      await fetchComments(selectedRequest.id);
    } catch (err) {
      console.error('Error adding comment:', err);
      alert('Kunde inte lägga till kommentar. Försök igen senare.');
    } finally {
      setPostingComment(false);
    }
  }

  async function handleUpdateStatus() {
    if (!selectedRequest || !newStatus) return;

    try {
      setUpdatingStatus(true);
      const { error } = await supabase
        .from('maintenance_requests')
        .update({ status: newStatus })
        .eq('id', selectedRequest.id);

      if (error) throw error;

      // Update local state
      setSelectedRequest({ ...selectedRequest, status: newStatus as MRStatus });
      await fetchRequests();
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Kunde inte uppdatera status. Försök igen senare.');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleAssignStaff() {
    if (!selectedRequest || !assignedTo) return;

    try {
      setUpdatingAssignment(true);
      const { error } = await supabase
        .from('maintenance_requests')
        .update({ assigned_to: assignedTo })
        .eq('id', selectedRequest.id);

      if (error) throw error;

      // Fetch updated staff member
      const { data: staff } = await supabase
        .from('profiles')
        .select('id, name, email, phone, role')
        .eq('id', assignedTo)
        .single();

      setSelectedRequest({
        ...selectedRequest,
        assigned_to: assignedTo,
        assigned: staff,
      });
      await fetchRequests();
    } catch (err) {
      console.error('Error assigning staff:', err);
      alert('Kunde inte tilldela personal. Försök igen senare.');
    } finally {
      setUpdatingAssignment(false);
    }
  }

  async function handleSaveInternalNotes() {
    if (!selectedRequest) return;

    try {
      setSavingNotes(true);
      const { error } = await supabase
        .from('maintenance_requests')
        .update({ internal_notes: internalNotes })
        .eq('id', selectedRequest.id);

      if (error) throw error;

      setSelectedRequest({ ...selectedRequest, internal_notes: internalNotes });
      await fetchRequests();
    } catch (err) {
      console.error('Error saving notes:', err);
      alert('Kunde inte spara anteckningar. Försök igen senare.');
    } finally {
      setSavingNotes(false);
    }
  }

  async function checkActiveEntry() {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('time_entries')
      .select('id, maintenance_request_id')
      .eq('user_id', user.id)
      .eq('status', 'draft')
      .gte('start_time', today)
      .is('end_time', null)
      .maybeSingle();
    setActiveEntry(data || null);
  }

  async function handleStampIn() {
    if (!user || !selectedRequest) return;
    try {
      setStampingIn(true);
      const { error } = await supabase.from('time_entries').insert({
        user_id: user.id,
        maintenance_request_id: selectedRequest.id,
        property_id: selectedRequest.property_id || null,
        category: stampCategory,
        start_time: new Date().toISOString(),
        end_time: null,
        break_minutes: 0,
        total_minutes: 0,
        comment: stampComment || '',
        status: 'draft',
      });
      if (error) throw error;
      setShowStampModal(false);
      setStampComment('');
      await checkActiveEntry();
    } catch (err) {
      console.error('Failed to stamp in:', err);
    } finally {
      setStampingIn(false);
    }
  }

  async function handleStampOut() {
    if (!activeEntry) return;
    try {
      setStampingIn(true);
      const { data: entry } = await supabase
        .from('time_entries')
        .select('start_time, break_minutes')
        .eq('id', activeEntry.id)
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
        .eq('id', activeEntry.id);
      setActiveEntry(null);
    } catch (err) {
      console.error('Failed to stamp out:', err);
    } finally {
      setStampingIn(false);
    }
  }

  async function handleCreateWorkOrder() {
    if (!user || !selectedRequest || !woForm.title) return;
    try {
      setCreatingWO(true);
      const { error } = await supabase.from('work_orders').insert({
        title: woForm.title,
        description: woForm.description,
        category: woForm.category,
        priority: woForm.priority,
        status: 'new',
        property_id: selectedRequest.property_id || null,
        apartment_id: selectedRequest.apartment_id || null,
        tenant_id: selectedRequest.tenant_id || null,
        maintenance_request_id: selectedRequest.id,
        assigned_to: woForm.assigned_to || null,
        created_by: user.id,
      });
      if (error) throw error;
      setShowCreateWOModal(false);
      setWoForm({ title: '', description: '', category: WO_CATEGORIES[0], priority: 'normal', assigned_to: '' });
    } catch (err) {
      console.error('Failed to create work order:', err);
    } finally {
      setCreatingWO(false);
    }
  }

  // Filter requests for display
  const filteredRequests = requests.filter(req => {
    const matchesSearch =
      req.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === 'all' || req.status === filterStatus;
    const matchesCategory =
      filterCategory === 'all' || req.category === filterCategory;
    const matchesPriority =
      filterPriority === 'all' || req.priority === filterPriority;

    return (
      matchesSearch && matchesStatus && matchesCategory && matchesPriority
    );
  });

  if (authLoading || loading) {
    return <LoadingPage />;
  }

  if (!user) {
    return (
      <EmptyState title="Du är inte inloggad" description="Logga in för att se dina felanmälningar" />
    );
  }

  return (
    <div className="space-y-6">
      {/* Tenant View */}
      {isTenant ? (
        <>
          <PageHeader
            title="Mina felanmälningar"
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowNewRequestModal(true)}
              >
                <Plus className="w-4 h-4" />
                Ny felanmälan
              </Button>
            }
          />

          {filteredRequests.length === 0 ? (
            <EmptyState
              icon={<Wrench className="w-12 h-12" />}
              title="Inga felanmälningar"
              description="Du har inga felanmälningar registrerade ännu"
              action={
                <Button
                  variant="primary"
                  onClick={() => setShowNewRequestModal(true)}
                >
                  <Plus className="w-4 h-4" />
                  Skapa felanmälan
                </Button>
              }
            />
          ) : (
            <div className="grid gap-4">
              {filteredRequests.map(req => (
                <Card
                  key={req.id}
                  onClick={() => {
                    setSelectedRequest(req);
                    setShowDetailModal(true);
                  }}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-slate-800 flex-1">
                        {req.title}
                      </h3>
                      <Badge className={getMRStatusColor(req.status)}>
                        {MR_STATUS_LABELS[req.status]}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge className={`text-xs ${req.category === 'water' ? 'text-blue-600 bg-blue-100' : req.category === 'electricity' ? 'text-yellow-600 bg-yellow-100' : 'text-slate-600 bg-slate-100'}`}>
                        {MR_CATEGORY_LABELS[req.category]}
                      </Badge>
                      <Badge className={getMRPriorityColor(req.priority)}>
                        {MR_PRIORITY_LABELS[req.priority]}
                      </Badge>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(req.created_at)}
                      </div>
                      {req.assigned && (
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          Tilldelad: {req.assigned.name}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* New Request Modal */}
          <Modal
            open={showNewRequestModal}
            onClose={() => setShowNewRequestModal(false)}
            title="Ny felanmälan"
            size="md"
          >
            <form onSubmit={handleCreateRequest} className="space-y-4">
              <Input
                label="Titel"
                value={newRequestForm.title}
                onChange={e =>
                  setNewRequestForm({ ...newRequestForm, title: e.target.value })
                }
                placeholder="T.ex. Läckande blandare"
                required
              />

              <Select
                label="Kategori"
                value={newRequestForm.category}
                onChange={e =>
                  setNewRequestForm({
                    ...newRequestForm,
                    category: e.target.value as MRCategory,
                  })
                }
                options={Object.entries(MR_CATEGORY_LABELS).map(([k, v]) => ({
                  value: k,
                  label: v,
                }))}
              />

              <Textarea
                label="Beskrivning"
                value={newRequestForm.description}
                onChange={e =>
                  setNewRequestForm({
                    ...newRequestForm,
                    description: e.target.value,
                  })
                }
                placeholder="Beskriv problemet..."
                rows={4}
                required
              />

              <Select
                label="Prioritet"
                value={newRequestForm.priority}
                onChange={e =>
                  setNewRequestForm({
                    ...newRequestForm,
                    priority: e.target.value as MRPriority,
                  })
                }
                options={Object.entries(MR_PRIORITY_LABELS).map(([k, v]) => ({
                  value: k,
                  label: v,
                }))}
              />

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="access_permission"
                    checked={newRequestForm.access_permission}
                    onChange={e =>
                      setNewRequestForm({
                        ...newRequestForm,
                        access_permission: e.target.checked,
                      })
                    }
                    className="rounded border-slate-300 accent-blue-600"
                  />
                  <label
                    htmlFor="access_permission"
                    className="text-sm text-slate-700"
                  >
                    Personal får använda huvudnyckel
                  </label>
                </div>
              </div>

              <Input
                label="Föredragna tider"
                value={newRequestForm.preferred_times}
                onChange={e =>
                  setNewRequestForm({
                    ...newRequestForm,
                    preferred_times: e.target.value,
                  })
                }
                placeholder="T.ex. Vardagar 9-17"
              />

              <Input
                label="Telefon"
                type="tel"
                value={newRequestForm.contact_phone}
                onChange={e =>
                  setNewRequestForm({
                    ...newRequestForm,
                    contact_phone: e.target.value,
                  })
                }
                placeholder="Din telefonnummer"
              />

              <div className="flex gap-2 pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  loading={submittingRequest}
                  className="flex-1"
                >
                  Skapa felanmälan
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowNewRequestModal(false)}
                  className="flex-1"
                >
                  Avbryt
                </Button>
              </div>
            </form>
          </Modal>

          {/* Detail Modal for Tenants */}
          <Modal
            open={showDetailModal && selectedRequest !== null}
            onClose={() => {
              setShowDetailModal(false);
              setSelectedRequest(null);
            }}
            title={selectedRequest?.title || 'Felanmälan'}
            size="lg"
          >
            {selectedRequest && (
              <div className="space-y-6">
                {/* Request Details */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                      Status
                    </h3>
                    <Badge className={getMRStatusColor(selectedRequest.status)}>
                      {MR_STATUS_LABELS[selectedRequest.status]}
                    </Badge>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                      Beskrivning
                    </h3>
                    <p className="text-sm text-slate-700">
                      {selectedRequest.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Kategori
                      </h3>
                      <p className="text-sm text-slate-700">
                        {MR_CATEGORY_LABELS[selectedRequest.category]}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Prioritet
                      </h3>
                      <Badge className={getMRPriorityColor(selectedRequest.priority)}>
                        {MR_PRIORITY_LABELS[selectedRequest.priority]}
                      </Badge>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Inlämnad
                      </h3>
                      <p className="text-sm text-slate-700">
                        {formatDateTime(selectedRequest.created_at)}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Tilldelad
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.assigned?.name || 'Ej tilldelad'}
                      </p>
                    </div>
                  </div>

                  {selectedRequest.access_permission && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-700">
                        Personal får använda huvudnyckel
                      </p>
                    </div>
                  )}

                  {selectedRequest.preferred_times && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Föredragna tider
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.preferred_times}
                      </p>
                    </div>
                  )}
                </div>

                {/* Comments Section */}
                <div className="border-t pt-6">
                  <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Kommentarer
                  </h3>

                  <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                    {loadingComments ? (
                      <p className="text-sm text-slate-500">Läser kommentarer...</p>
                    ) : comments.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Inga kommentarer ännu
                      </p>
                    ) : (
                      comments.map(comment => (
                        <div
                          key={comment.id}
                          className="p-3 bg-slate-50 rounded-lg"
                        >
                          <div className="flex items-start justify-between mb-1">
                            <p className="text-sm font-medium text-slate-700">
                              {comment.user?.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatDateTime(comment.created_at)}
                            </p>
                          </div>
                          <p className="text-sm text-slate-600">
                            {comment.comment}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment Form */}
                  <form onSubmit={handleAddComment} className="space-y-2">
                    <Textarea
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      placeholder="Lägg till kommentar..."
                      rows={3}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={postingComment}
                    >
                      Skicka kommentar
                    </Button>
                  </form>
                </div>
              </div>
            )}
          </Modal>
        </>
      ) : null}

      {/* Staff View */}
      {isStaff ? (
        <>
          <div className="flex items-center justify-between">
            <PageHeader title="Felanmälningar" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-4 h-4" />
              Filter
              <ChevronDown
                className={`w-4 h-4 transition-transform ${
                  showFilters ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <Card className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Sök titel..."
                />

                <Select
                  label="Status"
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value as FilterStatus)}
                  options={[
                    { value: 'all', label: 'Alla' },
                    ...Object.entries(MR_STATUS_LABELS).map(([k, v]) => ({
                      value: k,
                      label: v,
                    })),
                  ]}
                />

                <Select
                  label="Kategori"
                  value={filterCategory}
                  onChange={e =>
                    setFilterCategory(e.target.value as FilterCategory)
                  }
                  options={[
                    { value: 'all', label: 'Alla' },
                    ...Object.entries(MR_CATEGORY_LABELS).map(([k, v]) => ({
                      value: k,
                      label: v,
                    })),
                  ]}
                />

                <Select
                  label="Prioritet"
                  value={filterPriority}
                  onChange={e =>
                    setFilterPriority(e.target.value as FilterPriority)
                  }
                  options={[
                    { value: 'all', label: 'Alla' },
                    ...Object.entries(MR_PRIORITY_LABELS).map(([k, v]) => ({
                      value: k,
                      label: v,
                    })),
                  ]}
                />
              </div>
            </Card>
          )}

          {filteredRequests.length === 0 ? (
            <EmptyState
              icon={<Wrench className="w-12 h-12" />}
              title="Inga felanmälningar"
              description={
                searchQuery || filterStatus !== 'all'
                  ? 'Inga felanmälningar matchar dina filter'
                  : 'Inga felanmälningar registrerade'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Titel
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Hyresgäst
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Fastighet
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Kategori
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Prioritet
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Datum
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Tilldelad
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRequests.map(req => (
                    <tr
                      key={req.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => {
                        setSelectedRequest(req);
                        setShowDetailModal(true);
                      }}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{req.title}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-600">{req.tenant?.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-600">{req.property?.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-600">
                          {MR_CATEGORY_LABELS[req.category]}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={getMRPriorityColor(req.priority)}>
                          {MR_PRIORITY_LABELS[req.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={getMRStatusColor(req.status)}>
                          {MR_STATUS_LABELS[req.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDateTime(req.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {req.assigned?.name || '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Detail Modal for Staff */}
          <Modal
            open={showDetailModal && selectedRequest !== null}
            onClose={() => {
              setShowDetailModal(false);
              setSelectedRequest(null);
            }}
            title={selectedRequest?.title || 'Felanmälan'}
            size="lg"
          >
            {selectedRequest && (
              <div className="space-y-6">
                {/* Request Details */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                      Beskrivning
                    </h3>
                    <p className="text-sm text-slate-700">
                      {selectedRequest.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Hyresgäst
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.tenant?.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {selectedRequest.tenant?.email}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Fastighet
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.property?.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {selectedRequest.apartment?.apartment_number}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Kategori
                      </h3>
                      <p className="text-sm text-slate-700">
                        {MR_CATEGORY_LABELS[selectedRequest.category]}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Prioritet
                      </h3>
                      <Badge className={getMRPriorityColor(selectedRequest.priority)}>
                        {MR_PRIORITY_LABELS[selectedRequest.priority]}
                      </Badge>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Inlämnad
                      </h3>
                      <p className="text-sm text-slate-700">
                        {formatDateTime(selectedRequest.created_at)}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Tilldelad
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.assigned?.name || 'Ej tilldelad'}
                      </p>
                    </div>
                  </div>

                  {selectedRequest.access_permission && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-xs text-blue-700">
                        Personal får använda huvudnyckel
                      </p>
                    </div>
                  )}

                  {selectedRequest.preferred_times && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Föredragna tider
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.preferred_times}
                      </p>
                    </div>
                  )}

                  {selectedRequest.contact_info?.phone && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500 uppercase mb-1">
                        Telefon
                      </h3>
                      <p className="text-sm text-slate-700">
                        {selectedRequest.contact_info.phone}
                      </p>
                    </div>
                  )}
                </div>

                {/* Status and Assignment Controls */}
                <div className="border-t pt-6 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Select
                        label="Status"
                        value={newStatus}
                        onChange={e => setNewStatus(e.target.value as MRStatus)}
                        options={Object.entries(MR_STATUS_LABELS).map(
                          ([k, v]) => ({
                            value: k,
                            label: v,
                          })
                        )}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleUpdateStatus}
                        loading={updatingStatus}
                        className="w-full mt-2"
                      >
                        Uppdatera status
                      </Button>
                    </div>

                    <div>
                      <Select
                        label="Tilldela till"
                        value={assignedTo}
                        onChange={e => setAssignedTo(e.target.value)}
                        options={[
                          { value: '', label: 'Ej tilldelad' },
                          ...staffMembers.map(s => ({
                            value: s.id,
                            label: s.name,
                          })),
                        ]}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleAssignStaff}
                        loading={updatingAssignment}
                        className="w-full mt-2"
                      >
                        Tilldela
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Internal Notes */}
                <div className="border-t pt-6">
                  <Textarea
                    label="Interna anteckningar"
                    value={internalNotes}
                    onChange={e => setInternalNotes(e.target.value)}
                    placeholder="Lägg till interna anteckningar..."
                    rows={4}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveInternalNotes}
                    loading={savingNotes}
                    className="w-full mt-2"
                  >
                    Spara anteckningar
                  </Button>
                </div>

                {/* Comments Section */}
                <div className="border-t pt-6">
                  <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Kommentarer
                  </h3>

                  <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
                    {loadingComments ? (
                      <p className="text-sm text-slate-500">Läser kommentarer...</p>
                    ) : comments.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        Inga kommentarer ännu
                      </p>
                    ) : (
                      comments.map(comment => (
                        <div
                          key={comment.id}
                          className={`p-3 rounded-lg ${
                            comment.internal
                              ? 'bg-amber-50 border border-amber-200'
                              : 'bg-slate-50'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-1">
                            <div>
                              <p className="text-sm font-medium text-slate-700">
                                {comment.user?.name}
                              </p>
                              {comment.internal && (
                                <p className="text-xs text-amber-600">
                                  Intern kommentar
                                </p>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">
                              {formatDateTime(comment.created_at)}
                            </p>
                          </div>
                          <p className="text-sm text-slate-600">
                            {comment.comment}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment Form */}
                  <form onSubmit={handleAddComment} className="space-y-2">
                    <Textarea
                      value={commentText}
                      onChange={e => setCommentText(e.target.value)}
                      placeholder="Lägg till kommentar..."
                      rows={3}
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      loading={postingComment}
                    >
                      Skicka kommentar
                    </Button>
                  </form>
                </div>

                {/* Time tracking & Work order actions */}
                <div className="border-t pt-6 space-y-3">
                  <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    Tidstämpling
                  </h3>

                  {activeEntry?.maintenance_request_id === selectedRequest.id ? (
                    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-sm text-green-700 font-medium flex-1">Tidrapportering aktiv</span>
                      <Button variant="secondary" size="sm" onClick={handleStampOut} loading={stampingIn} className="gap-1">
                        <Square className="w-3 h-3" />
                        Stämpla ut
                      </Button>
                    </div>
                  ) : activeEntry ? (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      Du har en pågående tidrapport på en annan uppgift. Stämpla ut där först.
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      className="w-full gap-2"
                      onClick={() => setShowStampModal(true)}
                    >
                      <Play className="w-4 h-4" />
                      Stämpla in på denna felanmälan
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    className="w-full gap-2"
                    onClick={() => {
                      setWoForm({
                        title: selectedRequest.title,
                        description: selectedRequest.description,
                        category: WO_CATEGORIES[0],
                        priority: selectedRequest.priority === 'urgent' ? 'urgent' : 'normal',
                        assigned_to: selectedRequest.assigned_to || '',
                      });
                      setShowCreateWOModal(true);
                    }}
                  >
                    <ClipboardList className="w-4 h-4" />
                    Skapa arbetsorder från felanmälan
                  </Button>
                </div>
              </div>
            )}
          </Modal>
          {/* Stamp In Modal */}
          {selectedRequest && (
            <Modal open={showStampModal} onClose={() => setShowStampModal(false)} title={`Stämpla in — ${selectedRequest.title}`}>
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
                  <Button variant="secondary" onClick={() => setShowStampModal(false)} className="flex-1">Avbryt</Button>
                  <Button variant="primary" onClick={handleStampIn} loading={stampingIn} className="flex-1 gap-2">
                    <Play className="w-4 h-4" />
                    Stämpla in
                  </Button>
                </div>
              </div>
            </Modal>
          )}

          {/* Create Work Order Modal */}
          {selectedRequest && (
            <Modal open={showCreateWOModal} onClose={() => setShowCreateWOModal(false)} title="Skapa arbetsorder" size="lg">
              <div className="space-y-4">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
                  Skapar arbetsorder från felanmälan: <span className="font-medium text-slate-800">{selectedRequest.title}</span>
                </div>
                <Input
                  label="Titel"
                  value={woForm.title}
                  onChange={(e) => setWoForm({ ...woForm, title: e.target.value })}
                  placeholder="Beskriv arbetet kort"
                  required
                />
                <Textarea
                  label="Beskrivning"
                  value={woForm.description}
                  onChange={(e) => setWoForm({ ...woForm, description: e.target.value })}
                  rows={4}
                  placeholder="Detaljer om arbetet..."
                />
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label="Kategori"
                    value={woForm.category}
                    onChange={(e) => setWoForm({ ...woForm, category: e.target.value })}
                    options={WO_CATEGORIES.map((c) => ({ value: c, label: c }))}
                  />
                  <Select
                    label="Prioritet"
                    value={woForm.priority}
                    onChange={(e) => setWoForm({ ...woForm, priority: e.target.value })}
                    options={Object.entries(WO_PRIORITY_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                  />
                </div>
                <Select
                  label="Tilldelad till (valfritt)"
                  value={woForm.assigned_to}
                  onChange={(e) => setWoForm({ ...woForm, assigned_to: e.target.value })}
                  options={[{ value: '', label: '— Ingen —' }, ...staffMembers.map((s) => ({ value: s.id, label: s.name }))]}
                />
                <div className="flex gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setShowCreateWOModal(false)} className="flex-1">Avbryt</Button>
                  <Button variant="primary" onClick={handleCreateWorkOrder} loading={creatingWO} disabled={!woForm.title.trim()} className="flex-1 gap-2">
                    <ClipboardList className="w-4 h-4" />
                    Skapa arbetsorder
                  </Button>
                </div>
              </div>
            </Modal>
          )}
        </>
      ) : null}
    </div>
  );
}
