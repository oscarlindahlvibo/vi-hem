import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Input,
  Textarea,
  Select,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatDate, NEWS_TARGET_LABELS } from '../lib/utils';
import type { News, Property } from '../types';
import { Newspaper, Plus, Edit2, Calendar } from 'lucide-react';

interface NewsPageProps { onNavigate: (page: string) => void; }
export function NewsPage({ onNavigate: _onNavigate }: NewsPageProps) {
  const { user } = useAuth();
  const [news, setNews] = useState<News[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingNews, setEditingNews] = useState<News | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedNewsId, setExpandedNewsId] = useState<string | null>(null);

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTarget, setNewTarget] = useState<'all' | 'property'>('all');
  const [newTargetId, setNewTargetId] = useState('');
  const [newStatus, setNewStatus] = useState('published');
  const [newPublishedAt, setNewPublishedAt] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');

  const canManageNews = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    fetchNews();
    if (canManageNews) fetchProperties();
  }, [statusFilter, user?.id]);

  const fetchNews = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('news')
        .select('*')
        .order('published_at', { ascending: false });

      if (!canManageNews) {
        // Tenants see only published news
        query = query.eq('status', 'published');
      } else if (statusFilter !== 'all') {
        // Staff can filter by status
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setNews(data || []);
    } catch (error) {
      console.error('Error fetching news:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchProperties = async () => {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching properties:', error);
      return;
    }

    setProperties(data || []);
  };

  const resetForm = () => {
    setNewTitle('');
    setNewContent('');
    setNewTarget('all');
    setNewTargetId('');
    setNewStatus('published');
    setNewPublishedAt('');
    setNewImageUrl('');
    setEditingNews(null);
  };

  const createNews = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    if (newTarget === 'property' && !newTargetId) {
      alert('Välj en fastighet för nyheten.');
      return;
    }

    try {
      const newsData = {
        title: newTitle,
        content: newContent,
        target_type: newTarget,
        target_id: newTarget === 'property' ? newTargetId || null : null,
        status: newStatus,
        published_at: newPublishedAt || new Date().toISOString(),
        image_url: newImageUrl || null,
        created_by: user?.id,
        organisation_id: user?.organisation_id || null,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('news').insert(newsData);

      if (error) throw error;

      resetForm();
      setShowCreateModal(false);
      fetchNews();
    } catch (error) {
      console.error('Error creating news:', error);
    }
  };

  const updateNews = async () => {
    if (!editingNews || !newTitle.trim() || !newContent.trim()) return;
    if (newTarget === 'property' && !newTargetId) {
      alert('Välj en fastighet för nyheten.');
      return;
    }

    try {
      const { error } = await supabase
        .from('news')
        .update({
          title: newTitle,
          content: newContent,
          target_type: newTarget,
          target_id: newTarget === 'property' ? newTargetId || null : null,
          status: newStatus,
          published_at: newPublishedAt || new Date().toISOString(),
          image_url: newImageUrl || null,
        })
        .eq('id', editingNews.id);

      if (error) throw error;

      resetForm();
      setShowCreateModal(false);
      fetchNews();
    } catch (error) {
      console.error('Error updating news:', error);
    }
  };

  const deleteNews = async (id: string) => {
    if (!window.confirm('Är du säker på att du vill ta bort denna nyhet?'))
      return;

    try {
      const { error } = await supabase.from('news').delete().eq('id', id);

      if (error) throw error;
      fetchNews();
    } catch (error) {
      console.error('Error deleting news:', error);
    }
  };

  const openEditModal = (item: News) => {
    setEditingNews(item);
    setNewTitle(item.title);
    setNewContent(item.content);
    setNewTarget(item.target_type === 'property' ? 'property' : 'all');
    setNewTargetId(item.target_type === 'property' ? item.target_id || '' : '');
    setNewStatus(item.status);
    setNewPublishedAt(item.published_at || '');
    setNewImageUrl(item.image_url || '');
    setShowCreateModal(true);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'published':
        return 'bg-green-100 text-green-800';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'archived':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading && news.length === 0) {
    return <LoadingPage />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="Nyheter"
        icon={Newspaper}
        action={
          canManageNews && (
            <Button
              onClick={() => {
                resetForm();
                setShowCreateModal(true);
              }}
              variant="primary"
              className="gap-2"
            >
              <Plus size={18} />
              Ny nyhet
            </Button>
          )
        }
      />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Filter */}
        {canManageNews && (
          <div className="mb-8">
            <Select
              label="Status"
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              options={[
                { value: 'all', label: 'Alla' },
                { value: 'published', label: 'Publicerad' },
                { value: 'draft', label: 'Utkast' },
                { value: 'archived', label: 'Arkiverad' },
              ]}
            />
          </div>
        )}

        {news.length === 0 ? (
          <EmptyState
            icon={<Newspaper className="w-12 h-12" />}
            title="Inga nyheter"
            description={
              canManageNews
                ? 'Skapa din första nyhet'
                : 'Det finns inga nyheter att visa'
            }
          />
        ) : (
          <div className="space-y-6">
            {news.map((item: any) => (
              <Card key={item.id} className="hover:shadow-lg transition">
                <div className="p-6">
                  {/* Header with image if exists */}
                  {item.image_url && (
                    <div className="mb-4 -mx-6 -mt-6 h-48 overflow-hidden rounded-t-lg">
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Newspaper className="w-5 h-5 text-blue-600" />
                      {canManageNews && (
                        <Badge
                          className={getStatusColor(item.status)}
                          text={
                            item.status === 'published'
                              ? 'Publicerad'
                              : item.status === 'draft'
                                ? 'Utkast'
                                : 'Arkiverad'
                          }
                        />
                      )}
                    </div>

                    {canManageNews && (
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(item)}
                          className="gap-2"
                        >
                          <Edit2 size={16} />
                          Redigera
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteNews(item.id)}
                          className="gap-2 text-red-600 hover:text-red-700"
                        >
                          Radera
                        </Button>
                      </div>
                    )}
                  </div>

                  <h2 className="text-2xl font-bold text-gray-900 mb-2">
                    {item.title}
                  </h2>

                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
                    <Calendar size={16} />
                    {formatDate(item.published_at)}
                  </div>

                  <div className="mb-4">
                    <p className="text-gray-700 line-clamp-3">
                      {item.content}
                    </p>

                    {expandedNewsId !== item.id && item.content.length > 200 && (
                      <button
                        onClick={() => setExpandedNewsId(item.id)}
                        className="text-blue-600 hover:text-blue-700 font-medium mt-2 text-sm"
                      >
                        Läs mer
                      </button>
                    )}
                  </div>

                  {expandedNewsId === item.id && (
                    <div className="mb-4 p-4 bg-gray-50 rounded-lg max-h-96 overflow-y-auto">
                      <p className="text-gray-700 whitespace-pre-wrap">
                        {item.content}
                      </p>
                      <button
                        onClick={() => setExpandedNewsId(null)}
                        className="text-blue-600 hover:text-blue-700 font-medium mt-3 text-sm"
                      >
                        Visa mindre
                      </button>
                    </div>
                  )}

                  {canManageNews && (
                    <div className="pt-4 border-t border-gray-200">
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>
                          Målgrupp:{' '}
                          <span className="font-medium">
                            {NEWS_TARGET_LABELS[
                              item.target_type as keyof typeof NEWS_TARGET_LABELS
                            ] || item.target_type}
                            {item.target_type === 'property' && item.target_id
                              ? `: ${properties.find(property => property.id === item.target_id)?.name || 'Vald fastighet'}`
                              : ''}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit News Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-6">
                {editingNews ? 'Redigera nyhet' : 'Ny nyhet'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Titel
                  </label>
                  <Input
                    placeholder="Nyhetsrubrik"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Innehål
                  </label>
                  <Textarea
                    placeholder="Skriv nyhetsinnehållet här"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={8}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Målgrupp
                    </label>
                    <Select
                      value={newTarget}
                      onChange={(e: any) => {
                        setNewTarget(e.target.value);
                        if (e.target.value === 'all') setNewTargetId('');
                      }}
                      options={[
                        { value: 'all', label: 'Alla hyresgäster i organisationen' },
                        { value: 'property', label: 'Särskild fastighet' },
                      ]}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Status
                    </label>
                    <Select
                      value={newStatus}
                      onChange={(e: any) => setNewStatus(e.target.value)}
                      options={[
                        { value: 'draft', label: 'Utkast' },
                        { value: 'published', label: 'Publicerad' },
                        { value: 'archived', label: 'Arkiverad' },
                      ]}
                    />
                  </div>
                </div>

                {newTarget === 'property' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fastighet
                    </label>
                    <Select
                      value={newTargetId}
                      onChange={(e: any) => setNewTargetId(e.target.value)}
                      options={[
                        { value: '', label: 'Välj fastighet' },
                        ...properties.map(property => ({
                          value: property.id,
                          label: `${property.name} · ${property.address}`,
                        })),
                      ]}
                    />
                    {properties.length === 0 && (
                      <p className="text-xs text-amber-700 mt-1">
                        Ingen fastighet hittades i organisationen.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Publiceringsdatum
                  </label>
                  <Input
                    type="datetime-local"
                    value={newPublishedAt.slice(0, 16)}
                    onChange={(e) =>
                      setNewPublishedAt(
                        new Date(e.target.value).toISOString()
                      )
                    }
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bild-URL (valfritt)
                  </label>
                  <Input
                    placeholder="https://images.pexels.com/..."
                    value={newImageUrl}
                    onChange={(e) => setNewImageUrl(e.target.value)}
                  />
                  {newImageUrl && (
                    <div className="mt-2 rounded-lg overflow-hidden h-40">
                      <img
                        src={newImageUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <Button
                  variant="ghost"
                  onClick={() => {
                    resetForm();
                    setShowCreateModal(false);
                  }}
                  className="flex-1"
                >
                  Avbryt
                </Button>
                <Button
                  variant="primary"
                  onClick={editingNews ? updateNews : createNews}
                  className="flex-1"
                >
                  {editingNews ? 'Uppdatera' : 'Skapa nyhet'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
