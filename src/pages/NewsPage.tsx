import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useToast } from '../components/toast';
import React, { useState, useEffect, useCallback } from 'react';
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
  LoadingPage, Modal, Tabs, SearchInput,
} from '../components/ui';
import { formatDate, NEWS_AUDIENCE_LABELS, NEWS_PRIORITY_LABELS, NEWS_TARGET_LABELS } from '../lib/utils';
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
  const [newAudience, setNewAudience] = useState<'tenants' | 'staff' | 'all'>('tenants');
  const [newTarget, setNewTarget] = useState<'all' | 'property'>('all');
  const [newTargetId, setNewTargetId] = useState('');
  const [newPriority, setNewPriority] = useState<'normal' | 'important' | 'urgent'>('normal');
  const [newStatus, setNewStatus] = useState('published');
  const [newPublishedAt, setNewPublishedAt] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');

  const canManageNews = user?.role === 'staff' || user?.role === 'admin' || user?.role === 'superadmin';

  const [saving,setSaving]=useState(false);
  const [saveError,setSaveError]=useState('');
  const [loadError,setLoadError]=useState('');
  const [propertiesError,setPropertiesError]=useState('');
  const [editorStep,setEditorStep]=useState('content');
  const [search,setSearch]=useState('');
  const [discard,setDiscard]=useState(false);
  const toast=useToast();
  const dirty=useUnsavedChanges({newTitle,newContent,newAudience,newTarget,newTargetId,newPriority,newStatus,newPublishedAt,newImageUrl},showCreateModal);
  const closeEditor=()=>{if(saving)return;if(dirty){setDiscard(true);return;}setShowCreateModal(false);resetForm();};

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);setLoadError('');
      let query = supabase
        .from('vihem_news')
        .select('*')
        .order('published_at', { ascending: false });

      if(user?.organisation_id)query=query.eq('organisation_id',user.organisation_id);
      if (!canManageNews) {
        // Tenants see only published vihem_news
        query = query.eq('status', 'published');
      } else if (statusFilter !== 'all') {
        // Staff can filter by status
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setNews(data || []);
    } catch (error) {
      setLoadError('Nyheterna kunde inte hämtas. Försök igen.');
    } finally {
      setLoading(false);
    }
  },[canManageNews,statusFilter,user?.organisation_id]);

  const fetchProperties = useCallback(async () => {
    setPropertiesError('');
    const { data, error } = await supabase
      .from('vihem_properties')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) {
      setPropertiesError('Fastigheterna kunde inte hämtas. Försök igen innan du riktar nyheten.');
      return;
    }

    setProperties(data || []);
  },[]);
  useEffect(()=>{void fetchNews();if(canManageNews)void fetchProperties();},[fetchNews,fetchProperties,canManageNews]);

  const resetForm = () => {
    setSaveError('');setEditorStep('content');
    setNewTitle('');
    setNewContent('');
    setNewAudience('tenants');
    setNewTarget('all');
    setNewTargetId('');
    setNewPriority('normal');
    setNewStatus('published');
    setNewPublishedAt('');
    setNewImageUrl('');
    setEditingNews(null);
  };

  const createNews = async () => {
    if(saving)return;
    if (!newTitle.trim() || !newContent.trim()){setSaveError('Ange en rubrik och ett innehåll.');setEditorStep('content');return;}
    if (newTarget === 'property' && !newTargetId) {
      setSaveError('Välj en fastighet för nyheten.');
      return;
    }

    setSaving(true);setSaveError('');
    try {
      const newsData = {
        title: newTitle,
        content: newContent,
        audience: newAudience,
        target_type: newTarget,
        target_id: newTarget === 'property' ? newTargetId || null : null,
        priority: newPriority,
        status: newStatus,
        published_at: newPublishedAt || new Date().toISOString(),
        image_url: newImageUrl || null,
        created_by: user?.id,
        organisation_id: user?.organisation_id || null,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('vihem_news').insert(newsData).select('id').single();

      if (error) throw error;

      toast.show('Nyheten har sparats');
      resetForm();
      setShowCreateModal(false);
      void fetchNews();
    } catch (error) {
      setSaveError('Nyheten kunde inte sparas. Uppgifterna finns kvar – försök igen.');
    }finally{setSaving(false);}
  };

  const updateNews = async () => {
    if(saving||!editingNews)return;
    if (!newTitle.trim() || !newContent.trim()){setSaveError('Ange en rubrik och ett innehåll.');setEditorStep('content');return;}
    if (newTarget === 'property' && !newTargetId) {
      setSaveError('Välj en fastighet för nyheten.');
      return;
    }

    setSaving(true);setSaveError('');
    try {
      const { error } = await supabase
        .from('vihem_news')
        .update({
          title: newTitle,
          content: newContent,
          audience: newAudience,
          target_type: newTarget,
          target_id: newTarget === 'property' ? newTargetId || null : null,
          priority: newPriority,
          status: newStatus,
          published_at: newPublishedAt || new Date().toISOString(),
          image_url: newImageUrl || null,
        })
        .eq('id', editingNews.id).select('id').single();

      if (error) throw error;

      toast.show('Nyheten har sparats');
      resetForm();
      setShowCreateModal(false);
      void fetchNews();
    } catch (error) {
      setSaveError('Nyheten kunde inte sparas. Uppgifterna finns kvar – försök igen.');
    }finally{setSaving(false);}
  };

  const deleteNews = async (id: string) => {
    if (!window.confirm('Är du säker på att du vill ta bort denna nyhet?'))
      return;

    try {
      const { error } = await supabase.from('vihem_news').delete().eq('id', id);

      if (error) throw error;
      fetchNews();
    } catch (error) {
      setLoadError('Nyheten kunde inte tas bort. Försök igen.');
    }
  };

  const openEditModal = (item: News) => {
    setSaveError('');setEditorStep('content');
    setEditingNews(item);
    setNewTitle(item.title);
    setNewContent(item.content);
    setNewAudience(item.audience || 'tenants');
    setNewTarget(item.target_type === 'property' ? 'property' : 'all');
    setNewTargetId(item.target_type === 'property' ? item.target_id || '' : '');
    setNewPriority(item.priority || 'normal');
    setNewStatus(item.status);
    setNewPublishedAt(item.published_at || '');
    setNewImageUrl(item.image_url || '');
    setShowCreateModal(true);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'published':
        return 'bg-slate-100 text-slate-600';
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'archived':
        return 'bg-slate-100 text-slate-600';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800';
      case 'important':
        return 'bg-amber-100 text-amber-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  if (loading && news.length === 0) {
    return <LoadingPage />;
  }

  const visibleNews=news.filter(item=>[item.title,item.content].join(' ').toLowerCase().includes(search.toLowerCase()));
  const localDateTime=newPublishedAt?new Date(new Date(newPublishedAt).getTime()-new Date(newPublishedAt).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
  return (
    <div className="space-y-4">
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

      <div className="mx-auto max-w-4xl space-y-4">
        {loadError&&<div role="alert" className="vihem-feedback vihem-feedback-error">{loadError}<Button variant="secondary" onClick={()=>void fetchNews()}>Försök igen</Button></div>}
        <SearchInput value={search} onChange={setSearch} placeholder="Sök rubrik eller innehåll…"/>
        {canManageNews&&<Tabs active={statusFilter} onChange={setStatusFilter} tabs={[{key:'all',label:'Alla'},{key:'published',label:'Publicerade'},{key:'draft',label:'Utkast'},{key:'archived',label:'Arkiverade'}]} />}
        {loadError&&news.length===0?null:visibleNews.length === 0 ? (
          <EmptyState
            icon={<Newspaper className="w-12 h-12" />}
            title={search?'Inga nyheter matchar':'Inga nyheter'}
            description={
              canManageNews
                ? 'Skapa din första nyhet'
                : 'Det finns inga nyheter att visa'
            }
          />
        ) : (
          <div className="space-y-6">
            {visibleNews.map((item: any) => (
              <Card key={item.id} className="overflow-hidden">
                <div className="p-4 sm:p-5">
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

                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Newspaper className="w-5 h-5 text-blue-600" />
                      {canManageNews && (
                        <>
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
                          {item.priority&&item.priority!=='normal'&&<Badge className={getPriorityColor(item.priority)}>
                            {NEWS_PRIORITY_LABELS[item.priority]}
                          </Badge>}

                        </>
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

                  <h2 className="break-words text-lg font-semibold text-vihem-ink mb-2">
                    {item.title}
                  </h2>

                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
                    <Calendar size={16} />
                    {formatDate(item.published_at)}
                  </div>

                  <div className="mb-4"><p className={`whitespace-pre-wrap break-words text-sm leading-relaxed text-vihem-muted ${expandedNewsId===item.id||item.content.length<=200?'':'line-clamp-3'}`}>{item.content}</p>{item.content.length>200&&<Button variant="ghost" size="sm" className="mt-2" aria-expanded={expandedNewsId===item.id} onClick={()=>setExpandedNewsId(expandedNewsId===item.id?null:item.id)}>{expandedNewsId===item.id?'Visa mindre':'Läs mer'}</Button>}</div>
                  {canManageNews && (
                    <div className="pt-4 border-t border-gray-200">
                      <div className="text-sm text-gray-600 space-y-1">
                        <p>
                          Målgrupp:{' '}
                          <span className="font-medium">
                            {NEWS_AUDIENCE_LABELS[item.audience || 'tenants']} ·{' '}
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


      <Modal open={showCreateModal} onClose={closeEditor} title={editingNews?'Redigera nyhet':'Ny nyhet'} size="lg" mobileFullscreen toolbar={saveError?<div role="alert" className="vihem-feedback vihem-feedback-error">{saveError}</div>:undefined} footer={<><Button variant="secondary" disabled={saving} onClick={closeEditor}>Avbryt</Button>{editorStep==='content'?<Button onClick={()=>{if(!newTitle.trim()||!newContent.trim()){setSaveError('Ange en rubrik och ett innehåll.');return;}setSaveError('');setEditorStep('audience');}}>Fortsätt</Button>:<Button loading={saving} onClick={()=>void(editingNews?updateNews():createNews())}>{newStatus==='published'?'Publicera nyhet':newStatus==='draft'?'Spara utkast':'Spara arkiverad nyhet'}</Button>}</>}>
        <fieldset disabled={saving} className="space-y-5">
          <Tabs active={editorStep} onChange={setEditorStep} tabs={[{key:'content',label:'Innehåll'},{key:'audience',label:'Mottagare & publicering'}]}/>
          <div hidden={editorStep!=='content'} className="space-y-4">
            <Input label="Rubrik" value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Vad behöver mottagaren veta?"/>
            <Textarea label="Innehåll" value={newContent} onChange={e=>setNewContent(e.target.value)} rows={8} placeholder="Skriv nyheten här…"/>
            <details><summary className="vihem-touch-target cursor-pointer text-sm font-medium">Lägg till en bild</summary><div className="mt-2 space-y-2"><Input label="Bild-URL (valfritt)" type="url" value={newImageUrl} onChange={e=>setNewImageUrl(e.target.value)}/>{newImageUrl&&<img src={newImageUrl} alt="Nyhetens bildförhandsvisning" className="max-h-48 w-full rounded-xl object-contain"/>}</div></details>
          </div>
          <div hidden={editorStep!=='audience'} className="space-y-4">
            <div className="rounded-xl bg-vihem-canvas p-4"><p className="break-words font-semibold">{newTitle||'Nyhetens rubrik'}</p><p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-vihem-muted">{newContent}</p></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Mottagare" value={newAudience} onChange={e=>setNewAudience(e.target.value as typeof newAudience)} options={[{value:'tenants',label:'Hyresgäster'},{value:'staff',label:'Personal'},{value:'all',label:'Personal och hyresgäster'}]}/>
              <Select label="Område" value={newTarget} onChange={e=>{setNewTarget(e.target.value as typeof newTarget);if(e.target.value==='all')setNewTargetId('');}} options={[{value:'all',label:'Alla i valda mottagargruppen'},{value:'property',label:'Särskild fastighet'}]}/>
            </div>
            {newTarget==='property'&&<div>{propertiesError&&<div role="alert" className="vihem-feedback vihem-feedback-error">{propertiesError}<Button variant="secondary" onClick={()=>void fetchProperties()}>Försök igen</Button></div>}<Select label="Fastighet" value={newTargetId} onChange={e=>setNewTargetId(e.target.value)} options={[{value:'',label:'Välj fastighet'},...properties.map(property=>({value:property.id,label:`${property.name} · ${property.address}`}))]}/></div>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><Select label="Status" value={newStatus} onChange={e=>setNewStatus(e.target.value)} options={[{value:'draft',label:'Utkast'},{value:'published',label:'Publicerad'},{value:'archived',label:'Arkiverad'}]}/><Select label="Prioritet" value={newPriority} onChange={e=>setNewPriority(e.target.value as typeof newPriority)} options={[{value:'normal',label:'Normal'},{value:'important',label:'Viktig'},{value:'urgent',label:'Akut'}]}/></div>
            <Input label="Publiceringsdatum" type="datetime-local" value={localDateTime} onChange={e=>setNewPublishedAt(e.target.value?new Date(e.target.value).toISOString():'')}/>
            <p className="text-sm text-vihem-muted">{newStatus==='draft'?'Utkastet visas bara för behörig personal.':newStatus==='published'?'Nyheten visas för den valda mottagargruppen när du sparar.':'Nyheten sparas som arkiverad.'}</p>
          </div>
        </fieldset>
      </Modal>
      <Modal open={discard} onClose={()=>setDiscard(false)} title="Lämna osparade ändringar?" footer={<><Button variant="secondary" onClick={()=>setDiscard(false)}>Fortsätt redigera</Button><Button variant="danger" onClick={()=>{setDiscard(false);setShowCreateModal(false);resetForm();}}>Lämna utan att spara</Button></>}><p>Nyhetens innehåll och inställningar har inte sparats.</p></Modal>
    </div>
  );
}
