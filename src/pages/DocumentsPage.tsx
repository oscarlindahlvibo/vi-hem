import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Modal,
  Input,
  Select,
  Textarea,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatDate, DOCUMENT_TYPE_LABELS } from '../lib/utils';
import { Document, Profile, Property } from '../types';
import { FileText, Download, Upload, Search, Trash2 } from 'lucide-react';

interface DocumentsPageProps { onNavigate: (page: string) => void; }
export function DocumentsPage({ onNavigate: _onNavigate }: DocumentsPageProps) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [allDocuments, setAllDocuments] = useState<Document[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [tenants, setTenants] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [filterType, setFilterType] = useState('all');
  const [searchTitle, setSearchTitle] = useState('');
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('contract');
  const [newVisibility, setNewVisibility] = useState('tenant');
  const [newTenantId, setNewTenantId] = useState('');
  const [newPropertyId, setNewPropertyId] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFileUrl, setNewFileUrl] = useState('');

  const isStaff = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';
  const canDeleteDocuments = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    fetchDocuments();
    if (isStaff) {
      fetchProperties();
      fetchTenants();
    }
  }, []);

  useEffect(() => {
    let filtered = allDocuments;
    if (filterType !== 'all') {
      filtered = filtered.filter((d) => d.document_type === filterType);
    }
    if (searchTitle) {
      filtered = filtered.filter((d) =>
        d.title.toLowerCase().includes(searchTitle.toLowerCase())
      );
    }
    setDocuments(filtered);
  }, [filterType, searchTitle, allDocuments]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('vihem_documents')
        .select('*, tenant:vihem_profiles!documents_tenant_id_fkey(id, name, email), property:vihem_properties(id, name)');

      if (!isStaff) {
        query = query.eq('tenant_id', user?.id);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      setAllDocuments(data || []);
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching vihem_documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProperties = async () => {
    try {
      const { data, error } = await supabase
        .from('vihem_properties')
        .select('*')
        .order('name');
      if (error) throw error;
      setProperties(data || []);
    } catch (error) {
      console.error('Error fetching vihem_properties:', error);
    }
  };

  const fetchTenants = async () => {
    try {
      const { data, error } = await supabase
        .from('vihem_profiles')
        .select('*')
        .eq('role', 'tenant')
        .order('name');
      if (error) throw error;
      setTenants(data || []);
    } catch (error) {
      console.error('Error fetching tenants:', error);
    }
  };

  const createDocument = async () => {
    if (!newTitle.trim()) return;
    try {
      const { error } = await supabase.from('vihem_documents').insert({
        organisation_id: user?.organisation_id || null,
        title: newTitle,
        document_type: newType,
        visibility: newVisibility,
        description: newDescription || null,
        file_url: newFileUrl || null,
        file_name: newFileUrl ? newFileUrl.split('/').pop() || newTitle : null,
        file_size: 0,
        tenant_id: newTenantId || null,
        property_id: newPropertyId || null,
        created_by: user?.id,
      });
      if (error) throw error;
      setNewTitle('');
      setNewType('contract');
      setNewVisibility('tenant');
      setNewTenantId('');
      setNewPropertyId('');
      setNewDescription('');
      setNewFileUrl('');
      setShowCreateModal(false);
      fetchDocuments();
    } catch (error) {
      console.error('Error creating document:', error);
    }
  };

  const deleteDocument = async (doc: Document) => {
    if (!canDeleteDocuments) return;
    if (!window.confirm(`Ta bort dokumentet "${doc.title}"?`)) return;

    try {
      setDeletingDocumentId(doc.id);
      const { error } = await supabase.from('vihem_documents').delete().eq('id', doc.id);
      if (error) throw error;

      setAllDocuments((current) => current.filter((item) => item.id !== doc.id));
      setDocuments((current) => current.filter((item) => item.id !== doc.id));
    } catch (error) {
      console.error('Error deleting document:', error);
      window.alert('Kunde inte ta bort dokumentet. Kontrollera behörighet och försök igen.');
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const getDocumentColor = (type: string): string => {
    const colors: Record<string, string> = {
      contract: 'bg-blue-100 text-blue-700',
      invoice: 'bg-green-100 text-green-700',
      rules: 'bg-amber-100 text-amber-700',
      inspection: 'bg-orange-100 text-orange-700',
      other: 'bg-slate-100 text-slate-700',
    };
    return colors[type] || colors.other;
  };

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Dokument"
          subtitle="Dina dokument och kontrakt"
          action={
            isStaff ? (
              <Button onClick={() => setShowCreateModal(true)} variant="primary" className="gap-2">
                <Upload size={18} />
                Nytt dokument
              </Button>
            ) : undefined
          }
        />

        {/* Filters */}
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Sök efter dokumenttitel..."
              value={searchTitle}
              onChange={(e) => setSearchTitle(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="all">Alla typer</option>
            <option value="contract">Kontrakt</option>
            <option value="rules">Regler</option>
            <option value="inspection">Besiktning</option>
            <option value="invoice">Faktura</option>
            <option value="other">Övrigt</option>
          </select>

          <div className="flex gap-2">
            <Button
              variant={view === 'grid' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setView('grid')}
            >
              Rutnät
            </Button>
            <Button
              variant={view === 'list' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setView('list')}
            >
              Lista
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-12 h-12" />}
            title="Inga dokument"
            description="Det finns inga dokument att visa"
          />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {documents.map((doc: any) => (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-blue-600" />
                    </div>
                    <Badge className={getDocumentColor(doc.document_type)}>
                      {DOCUMENT_TYPE_LABELS[doc.document_type as keyof typeof DOCUMENT_TYPE_LABELS] || doc.document_type}
                    </Badge>
                  </div>

                  <h3 className="font-semibold text-slate-900 mb-1 line-clamp-2">{doc.title}</h3>

                  {doc.description && (
                    <p className="text-sm text-slate-500 mb-3 line-clamp-2">{doc.description}</p>
                  )}

                  {isStaff && doc.tenant?.name && (
                    <p className="text-xs text-slate-500 mb-1">Hyresgäst: {doc.tenant.name}</p>
                  )}
                  {isStaff && doc.property?.name && (
                    <p className="text-xs text-slate-500 mb-1">Fastighet: {doc.property.name}</p>
                  )}

                  <p className="text-xs text-slate-400 mb-4">{formatDate(doc.created_at)}</p>

                  <div className="flex flex-col gap-2">
                    {doc.file_url ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => window.open(doc.file_url, '_blank')}
                      >
                        <Download size={14} />
                        Ladda ner
                      </Button>
                    ) : (
                      <p className="text-xs text-center text-slate-400 py-1">Ingen fil bifogad</p>
                    )}
                    {canDeleteDocuments && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full gap-2 text-red-600 hover:bg-red-50"
                        onClick={() => deleteDocument(doc)}
                        disabled={deletingDocumentId === doc.id}
                      >
                        <Trash2 size={14} />
                        {deletingDocumentId === doc.id ? 'Tar bort...' : 'Ta bort'}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Titel</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Typ</th>
                    {isStaff && (
                      <>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Hyresgäst</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Fastighet</th>
                      </>
                    )}
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Datum</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((doc: any) => (
                    <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{doc.title}</td>
                      <td className="px-4 py-3">
                        <Badge className={getDocumentColor(doc.document_type)}>
                          {DOCUMENT_TYPE_LABELS[doc.document_type as keyof typeof DOCUMENT_TYPE_LABELS] || doc.document_type}
                        </Badge>
                      </td>
                      {isStaff && (
                        <>
                          <td className="px-4 py-3 text-sm text-slate-600">{doc.tenant?.name || '—'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{doc.property?.name || '—'}</td>
                        </>
                      )}
                      <td className="px-4 py-3 text-sm text-slate-500">{formatDate(doc.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {doc.file_url ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => window.open(doc.file_url, '_blank')}
                              className="gap-1"
                            >
                              <Download size={14} />
                              Ladda ner
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-400 self-center">Ingen fil</span>
                          )}
                          {canDeleteDocuments && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteDocument(doc)}
                              disabled={deletingDocumentId === doc.id}
                              className="gap-1 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={14} />
                              {deletingDocumentId === doc.id ? 'Tar bort...' : 'Ta bort'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Nytt dokument" size="lg">
        <div className="space-y-4">
          <Input
            label="Titel"
            placeholder="Dokumenttitel"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Dokumenttyp"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              options={[
                { value: 'contract', label: 'Kontrakt' },
                { value: 'rules', label: 'Regler' },
                { value: 'inspection', label: 'Besiktning' },
                { value: 'invoice', label: 'Faktura' },
                { value: 'other', label: 'Övrigt' },
              ]}
            />
            <Select
              label="Synlighet"
              value={newVisibility}
              onChange={(e) => setNewVisibility(e.target.value)}
              options={[
                { value: 'public', label: 'Offentlig' },
                { value: 'tenant', label: 'Hyresgäst' },
                { value: 'staff', label: 'Personal' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Hyresgäst (valfritt)"
              value={newTenantId}
              onChange={(e) => setNewTenantId(e.target.value)}
              options={[
                { value: '', label: 'Välj hyresgäst' },
                ...tenants.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
            <Select
              label="Fastighet (valfritt)"
              value={newPropertyId}
              onChange={(e) => setNewPropertyId(e.target.value)}
              options={[
                { value: '', label: 'Välj fastighet' },
                ...properties.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>

          <Textarea
            label="Beskrivning"
            placeholder="Dokumentbeskrivning"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={3}
          />

          <Input
            label="Fil-URL"
            placeholder="https://example.com/dokument.pdf"
            value={newFileUrl}
            onChange={(e) => setNewFileUrl(e.target.value)}
          />

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)} className="flex-1">
              Avbryt
            </Button>
            <Button variant="primary" onClick={createDocument} className="flex-1">
              Skapa dokument
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
