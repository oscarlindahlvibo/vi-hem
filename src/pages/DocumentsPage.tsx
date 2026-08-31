import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
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
import { formatDate, saveOrShareFile, DOCUMENT_CATEGORY_LABELS, DOCUMENT_CONTRACT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '../lib/utils';
import { Document, Profile, Property } from '../types';
import { FileText, Download, Upload, Search, Trash2, FolderOpen } from 'lucide-react';

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
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchTitle, setSearchTitle] = useState('');
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [savingDocument, setSavingDocument] = useState(false);
  const [formError, setFormError] = useState('');

  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState('contract');
  const [newCategory, setNewCategory] = useState('residential_lease');
  const [newContractStatus, setNewContractStatus] = useState('signed');
  const [newVisibility, setNewVisibility] = useState('tenant');
  const [newTenantId, setNewTenantId] = useState('');
  const [newPropertyId, setNewPropertyId] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFileUrl, setNewFileUrl] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);

  const isStaff = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';
  const canDeleteDocuments = user?.role === 'admin' || user?.role === 'superadmin';
  const canCreateDocuments = isStaff;

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
    if (filterCategory !== 'all') {
      filtered = filtered.filter((d) => (d.document_category || fallbackCategory(d.document_type)) === filterCategory);
    }
    if (searchTitle) {
      filtered = filtered.filter((d) =>
        d.title.toLowerCase().includes(searchTitle.toLowerCase())
      );
    }
    setDocuments(filtered);
  }, [filterType, filterCategory, searchTitle, allDocuments]);

  const resetCreateForm = () => {
    setNewTitle('');
    setNewType('contract');
    setNewCategory('residential_lease');
    setNewContractStatus('signed');
    setNewVisibility('tenant');
    setNewTenantId('');
    setNewPropertyId('');
    setNewDescription('');
    setNewFileUrl('');
    setNewFile(null);
    setFormError('');
  };

  const fallbackCategory = (type: string) => {
    if (type === 'contract') return 'residential_lease';
    if (type === 'inspection') return 'inspection_protocol';
    if (type === 'rules') return 'house_rules';
    if (type === 'invoice') return 'invoice';
    return 'other';
  };

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const safePathPart = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

  const fileToBase64 = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  };

  const uploadToGoogleDrive = async (file: File, folder: string) => {
    const { data: settingsData, error: settingsError } = await supabase.functions.invoke('vihem-google-drive-storage', {
      body: { action: 'settings' },
    });
    if (settingsError) throw settingsError;
    const settings = settingsData?.settings;
    if (!settings?.enabled) return { enabled: false as const };

    const { data, error } = await supabase.functions.invoke('vihem-google-drive-storage', {
      body: {
        action: 'upload',
        filename: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: await fileToBase64(file),
        folder,
      },
    });
    if (error) throw new Error(data?.error || error.message || 'Google Drive-uppladdningen misslyckades.');
    if (!data?.ok || !data?.id) throw new Error(data?.error || 'Google Drive returnerade inget fil-ID.');
    return { enabled: true as const, data };
  };

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
    setFormError('');
    setSavingDocument(true);

    try {
      const fileUrl = newFileUrl || null;
      let fileName = newFileUrl ? newFileUrl.split('/').pop() || newTitle : null;
      let fileSize = 0;
      let storageBucket: string | null = null;
      let storagePath: string | null = null;
      let storageProvider = 'supabase';
      let driveFileId: string | null = null;
      let driveWebUrl: string | null = null;
      let driveFolderId: string | null = null;

      if (newFile) {
        const organisationPath = user?.organisation_id || 'platform';
        const timestamp = Date.now();
        const path = `${organisationPath}/${user?.id || 'unknown'}/${timestamp}-${safePathPart(newFile.name)}`;
        let driveError: unknown = null;
        try {
          const driveUpload = await uploadToGoogleDrive(newFile, `Dokument/${newCategory}`);
          if (driveUpload.enabled) {
            storageProvider = 'google_drive';
            driveFileId = driveUpload.data.id;
            driveWebUrl = driveUpload.data.webViewLink || null;
            driveFolderId = driveUpload.data.folder_id || null;
          }
        } catch (error) {
          driveError = error;
        }

        if (storageProvider !== 'google_drive') {
          if (driveError) {
            const { data: driveSettings } = await supabase.functions.invoke('vihem-google-drive-storage', { body: { action: 'settings' } });
            if (driveSettings?.settings?.enabled && driveSettings?.settings?.fallback_enabled === false) {
              throw driveError;
            }
          }

          const { error: uploadError } = await supabase.storage
            .from('vihem-documents')
            .upload(path, newFile, { upsert: false });

          if (uploadError) {
            if (uploadError.message.toLowerCase().includes('bucket')) {
              throw new Error('Storage-bucketen vihem-documents saknas. Kör senaste Supabase-migrationerna först.');
            }
            throw uploadError;
          }

          storageBucket = 'vihem-documents';
          storagePath = path;
        }
        fileName = newFile.name;
        fileSize = newFile.size;
      }

      const { error } = await supabase.from('vihem_documents').insert({
        organisation_id: user?.organisation_id || null,
        title: newTitle,
        document_type: newType,
        document_category: newCategory,
        contract_status: newType === 'contract' ? newContractStatus : 'not_applicable',
        visibility: newVisibility,
        description: newDescription || null,
        file_url: fileUrl,
        file_name: fileName,
        file_size: fileSize,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        storage_provider: storageProvider,
        drive_file_id: driveFileId,
        drive_web_url: driveWebUrl,
        drive_folder_id: driveFolderId,
        drive_synced_at: storageProvider === 'google_drive' ? new Date().toISOString() : null,
        tenant_id: newTenantId || null,
        property_id: newPropertyId || null,
        created_by: user?.id,
      });
      if (error) throw error;
      resetCreateForm();
      setShowCreateModal(false);
      fetchDocuments();
    } catch (error) {
      console.error('Error creating document:', error);
      setFormError(error instanceof Error ? error.message : 'Kunde inte skapa dokumentet.');
    } finally {
      setSavingDocument(false);
    }
  };

  const downloadDocument = async (doc: Document) => {
    try {
      if ((doc as Document & { drive_web_url?: string }).drive_web_url) {
        window.open((doc as Document & { drive_web_url: string }).drive_web_url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (doc.storage_bucket && doc.storage_path) {
        const { data, error } = await supabase.storage
          .from(doc.storage_bucket)
          .createSignedUrl(doc.storage_path, 60 * 10);
        if (error) throw error;
        if (data?.signedUrl) {
          window.open(data.signedUrl, '_blank');
          return;
        }
      }
      if (doc.file_url) {
        if (doc.file_url.startsWith('data:')) {
          // iOS/Safari may render a data: PDF as a blank page, so this
          // fetches it into a real Blob first. On the web that opens fine
          // in a new tab via a blob: URL; the native app can't do that
          // (WKWebView doesn't support opening blob: URLs in a new tab),
          // so it goes through the native Share sheet instead.
          const response = await fetch(doc.file_url);
          if (!response.ok) throw new Error('Dokumentet kunde inte läsas.');
          const blob = await response.blob();
          if (Capacitor.isNativePlatform()) {
            await saveOrShareFile(blob, doc.file_name || doc.title);
          } else {
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
          }
        } else {
          window.open(doc.file_url, '_blank');
        }
      }
    } catch (error) {
      console.error('Error opening document:', error);
      window.alert('Kunde inte öppna dokumentet.');
    }
  };

  const deleteDocument = async (doc: Document) => {
    if (!canDeleteDocuments) return;
    if (!window.confirm(`Ta bort dokumentet "${doc.title}"?`)) return;

    try {
      setDeletingDocumentId(doc.id);
      if (doc.storage_bucket && doc.storage_path) {
        const { error: storageError } = await supabase.storage
          .from(doc.storage_bucket)
          .remove([doc.storage_path]);
        if (storageError) {
          console.warn('Could not delete storage object, deleting database row only:', storageError);
        }
      }
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
      notice: 'bg-purple-100 text-purple-700',
      certificate: 'bg-teal-100 text-teal-700',
      template: 'bg-indigo-100 text-indigo-700',
    };
    return colors[type] || colors.other;
  };

  const typeOptions = [
    { value: 'contract', label: 'Avtal' },
    { value: 'rules', label: 'Regler' },
    { value: 'inspection', label: 'Besiktning' },
    { value: 'invoice', label: 'Faktura' },
    { value: 'notice', label: 'Meddelande' },
    { value: 'certificate', label: 'Intyg' },
    { value: 'template', label: 'Mall' },
    { value: 'other', label: 'Övrigt' },
  ];

  const categoryOptions = [
    { value: 'residential_lease', label: 'Bostadshyresavtal' },
    { value: 'premises_lease', label: 'Lokalhyresavtal' },
    { value: 'parking_agreement', label: 'Parkeringsavtal' },
    { value: 'storage_agreement', label: 'Förrådsavtal' },
    { value: 'lease_addendum', label: 'Tilläggsavtal' },
    { value: 'termination', label: 'Uppsägning' },
    { value: 'inspection_protocol', label: 'Besiktningsprotokoll' },
    { value: 'house_rules', label: 'Ordningsregler' },
    { value: 'rent_notice', label: 'Hyresavi' },
    { value: 'invoice', label: 'Faktura' },
    { value: 'template', label: 'Mall' },
    { value: 'other', label: 'Övrigt' },
  ];

  const categoryCounts = allDocuments.reduce<Record<string, number>>((acc, doc) => {
    const category = doc.document_category || fallbackCategory(doc.document_type);
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  if (loading) return <LoadingPage />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Dokument"
          subtitle="Dina dokument och kontrakt"
          action={
            canCreateDocuments ? (
              <Button onClick={() => setShowCreateModal(true)} variant="primary" className="gap-2">
                <Upload size={18} />
                Nytt dokument
              </Button>
            ) : undefined
          }
        />

        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => setFilterCategory('all')}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              filterCategory === 'all' ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            Alla ({allDocuments.length})
          </button>
          {categoryOptions.map((category) => {
            const count = categoryCounts[category.value] || 0;
            if (count === 0) return null;
            return (
              <button
                key={category.value}
                onClick={() => setFilterCategory(category.value)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  filterCategory === category.value ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {category.label} ({count})
              </button>
            );
          })}
        </div>

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
            <option value="notice">Meddelande</option>
            <option value="certificate">Intyg</option>
            <option value="template">Mall</option>
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
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Badge className="bg-slate-100 text-slate-700">
                      {DOCUMENT_CATEGORY_LABELS[(doc.document_category || fallbackCategory(doc.document_type)) as keyof typeof DOCUMENT_CATEGORY_LABELS] || 'Övrigt'}
                    </Badge>
                    {doc.document_type === 'contract' && (
                      <Badge className={doc.contract_status === 'signed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
                        {DOCUMENT_CONTRACT_STATUS_LABELS[doc.contract_status || 'not_applicable']}
                      </Badge>
                    )}
                  </div>

                  {doc.description && (
                    <p className="text-sm text-slate-500 mb-3 line-clamp-2">{doc.description}</p>
                  )}

                  {isStaff && doc.tenant?.name && (
                    <p className="text-xs text-slate-500 mb-1">Hyresgäst: {doc.tenant.name}</p>
                  )}
                  {isStaff && doc.property?.name && (
                    <p className="text-xs text-slate-500 mb-1">Fastighet: {doc.property.name}</p>
                  )}

                  <p className="text-xs text-slate-400 mb-4">
                    {formatDate(doc.created_at)}
                    {doc.file_name ? ` • ${doc.file_name}` : ''}
                    {doc.file_size ? ` • ${formatBytes(doc.file_size)}` : ''}
                  </p>

                  <div className="flex flex-col gap-2">
                    {doc.file_url || doc.storage_path ? (
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-full gap-2"
                        onClick={() => downloadDocument(doc)}
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
                    <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Kategori</th>
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
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge className="bg-slate-100 text-slate-700">
                            {DOCUMENT_CATEGORY_LABELS[(doc.document_category || fallbackCategory(doc.document_type)) as keyof typeof DOCUMENT_CATEGORY_LABELS] || 'Övrigt'}
                          </Badge>
                          {doc.document_type === 'contract' && (
                            <Badge className={doc.contract_status === 'signed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
                              {DOCUMENT_CONTRACT_STATUS_LABELS[doc.contract_status || 'not_applicable']}
                            </Badge>
                          )}
                        </div>
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
                          {doc.file_url || doc.storage_path ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => downloadDocument(doc)}
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

      <Modal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetCreateForm();
        }}
        title="Nytt dokument"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Titel"
            placeholder="Dokumenttitel"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Dokumenttyp"
              value={newType}
              onChange={(e) => {
                const nextType = e.target.value;
                setNewType(nextType);
                setNewCategory(fallbackCategory(nextType));
                setNewContractStatus(nextType === 'contract' ? 'signed' : 'not_applicable');
              }}
              options={typeOptions}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Kategori"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              options={categoryOptions}
            />
            <Select
              label="Avtalsstatus"
              value={newContractStatus}
              onChange={(e) => setNewContractStatus(e.target.value)}
              disabled={newType !== 'contract'}
              options={[
                { value: 'not_applicable', label: 'Ej avtal' },
                { value: 'draft', label: 'Utkast' },
                { value: 'pending_signature', label: 'Väntar signering' },
                { value: 'signed', label: 'Signerat' },
                { value: 'cancelled', label: 'Avbrutet' },
                { value: 'archived', label: 'Arkiverat' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            label="Extern fil-URL (valfritt)"
            placeholder="https://example.com/dokument.pdf"
            value={newFileUrl}
            onChange={(e) => setNewFileUrl(e.target.value)}
            disabled={Boolean(newFile)}
          />

          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <FolderOpen className="h-6 w-6" />
              </span>
              <span className="text-sm font-semibold text-slate-800">
                {newFile ? newFile.name : 'Ladda upp PDF, bild eller Word-fil'}
              </span>
              <span className="text-xs text-slate-500">
                {newFile ? formatBytes(newFile.size) : 'Max 50 MB. Uppladdningen sparas i vihem-documents.'}
              </span>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                onChange={(event) => {
                  setNewFile(event.target.files?.[0] || null);
                  if (event.target.files?.[0]) setNewFileUrl('');
                }}
              />
            </label>
            {newFile && (
              <button
                type="button"
                onClick={() => setNewFile(null)}
                className="mt-3 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
              >
                Ta bort vald fil
              </button>
            )}
          </div>

          {formError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {formError}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateModal(false);
                resetCreateForm();
              }}
              className="flex-1"
            >
              Avbryt
            </Button>
            <Button variant="primary" onClick={createDocument} className="flex-1" loading={savingDocument}>
              Skapa dokument
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
