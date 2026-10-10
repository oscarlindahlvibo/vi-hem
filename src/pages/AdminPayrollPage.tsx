import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BarChart3, Calendar, Download, CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Card,
  Avatar,
  SearchInput,
  Tabs,
  Input,
  Badge,
  Button,
  Modal,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatMinutes, formatDateTime } from '../lib/utils';
import { useTimeCategories } from '../contexts/TimeCategoriesContext';
import { TimeEntry, Profile } from '../types';

const TIME_STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  submitted: 'Inlämnad',
  approved: 'Godkänd',
  rejected: 'Avvisad',
};

const TIME_STATUS_COLORS: Record<string, string> = {
  draft: 'text-slate-600 bg-slate-100',
  submitted: 'text-blue-700 bg-blue-100',
  approved: 'text-green-700 bg-green-100',
  rejected: 'text-red-700 bg-red-100',
};

interface AdminPayrollPageProps { onNavigate: (page: string) => void; }
export function AdminPayrollPage({ onNavigate: _onNavigate }: AdminPayrollPageProps) {
  const { labelFor } = useTimeCategories();
  const [error,setError]=useState('');
  const [actionError,setActionError]=useState('');
  const [pending,setPending]=useState(false);
  const actionLock=useRef(false);
  const loadSequence=useRef(0);
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('all');
  const [confirmAll,setConfirmAll]=useState(false);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  const fetchData = useCallback(async () => {
    if(!/^\d{4}-\d{2}$/.test(selectedMonth))return;
    const sequence=++loadSequence.current;
    try {
      setLoading(true);setError('');
      const [year,month]=selectedMonth.split('-').map(Number);
      const startOfMonth=`${selectedMonth}-01`;
      const nextMonth=`${year+(month===12?1:0)}-${String(month===12?1:month+1).padStart(2,'0')}-01`;
      const [entriesRes, profilesRes] = await Promise.all([
        supabase
          .from('vihem_time_entries')
          .select('*')
          .gte('start_time', `${startOfMonth}T00:00:00`)
          .lt('start_time', `${nextMonth}T00:00:00`)
          .order('start_time', { ascending: false }),
        supabase
          .from('vihem_profiles')
          .select('*')
          .in('role', ['staff', 'admin'])
          .order('name'),
      ]);

      if(sequence!==loadSequence.current)return;
      if(entriesRes.error)throw entriesRes.error;
      if(profilesRes.error)throw profilesRes.error;
      if (entriesRes.data) setTimeEntries(entriesRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data);
    } catch (error) {
      if(sequence===loadSequence.current)setError('Löneunderlaget kunde inte hämtas. Försök igen.');
    } finally {
      if(sequence===loadSequence.current)setLoading(false);
    }
  },[selectedMonth]);
  // Sequence guards old period responses; this ref is a request counter, not a DOM node.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void fetchData();return()=>{loadSequence.current++;};},[fetchData]);

  const getEntriesForUser = (userId: string) =>
    timeEntries.filter((e) => e.user_id === userId);

  const calculateStats = (entries: TimeEntry[]) => {
    let total = 0, approved = 0, submitted = 0, draft = 0, rejected = 0;
    entries.forEach((e) => {
      const mins = e.total_minutes || 0;
      total += mins;
      if (e.status === 'approved') approved += mins;
      else if (e.status === 'submitted') submitted += mins;
      else if (e.status === 'draft') draft += mins;
      else if (e.status === 'rejected') rejected += mins;
    });
    return { total, approved, submitted, draft, rejected };
  };

  const getAllStats = () => calculateStats(timeEntries);

  const changeStatus=async(ids:string[],status:'approved'|'rejected')=>{
    if(actionLock.current||!ids.length)return;
    actionLock.current=true;setPending(true);setActionError('');
    try{
      const {data,error:saveError}=await supabase.from('vihem_time_entries').update({status}).in('id',ids).select('id,status');
      if(saveError)throw saveError;
      if(data?.length!==ids.length)throw new Error('Alla tidposter kunde inte uppdateras. Läs om underlaget innan du fortsätter.');
      setTimeEntries(entries=>entries.map(entry=>ids.includes(entry.id)?{...entry,status}:entry));
      setConfirmAll(false);
    }catch(err){setActionError(err instanceof Error?err.message:'Ändringen kunde inte sparas. Försök igen.');}
    finally{actionLock.current=false;setPending(false);}
  };
  const exportSummary=()=>{
    const quote=(value:string)=>'"'+(/^[=+@-]/.test(value)?"'":'')+value.replace(/"/g,'""')+'"';
    const lines=[['Namn','Månad','Totalt (min)','Godkänt (min)','Inlämnat (min)','Utkast (min)','Avvisat (min)'],...profiles.filter(p=>getEntriesForUser(p.id).length).map(p=>{const stats=calculateStats(getEntriesForUser(p.id));return[p.name||'',selectedMonth,...[stats.total,stats.approved,stats.submitted,stats.draft,stats.rejected].map(String)];})];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`loneunderlag-${selectedMonth}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  if (loading) return <LoadingPage />;

  const staffWithEntries = profiles.filter(p=>getEntriesForUser(p.id).length>0&&(p.name||'').toLowerCase().includes(search.toLowerCase())&&(filter==='all'||getEntriesForUser(p.id).some(entry=>entry.status==='submitted'||entry.status==='draft')));
  const allStats = getAllStats();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Löneöversikt"
          subtitle="Översikt över timmar och tidposter per månad"
        />

        <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-500" />
            <Input label="Period"
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={exportSummary}
          >
            <Download className="w-4 h-4" />
            Exportera
          </Button>
        </div>

        <div className="mb-5 flex flex-wrap gap-x-8 gap-y-3 border-y border-vihem-line py-4"><div><p className="text-sm text-vihem-muted">Totalt</p><p className="text-xl font-semibold tabular-nums">{formatMinutes(allStats.total)}</p></div><div><p className="text-sm text-vihem-muted">Godkänt</p><p className="text-xl font-semibold tabular-nums">{formatMinutes(allStats.approved)}</p></div><div><p className="text-sm text-vihem-muted">Att granska</p><p className="text-xl font-semibold tabular-nums">{formatMinutes(allStats.submitted+allStats.draft)}</p></div></div>
        {error&&<div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<Button variant="secondary" onClick={()=>void fetchData()}>Försök igen</Button></div>}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center"><SearchInput value={search} onChange={setSearch} placeholder="Sök medarbetare…"/><Tabs active={filter} onChange={setFilter} tabs={[{key:'all',label:'Alla'},{key:'pending',label:'Att granska'}]}/></div>
        <div className="divide-y divide-vihem-line md:hidden">{staffWithEntries.map(profile=>{const stats=calculateStats(getEntriesForUser(profile.id));return <button key={profile.id} className="vihem-focus flex w-full items-center gap-3 py-4 text-left" onClick={()=>{setSelectedUser(profile);setShowDetailModal(true);setActionError('');}}><Avatar userId={profile.id} name={profile.name}/><span className="min-w-0 flex-1"><span className="block font-medium">{profile.name}</span><span className="block text-sm text-vihem-muted">{formatMinutes(stats.submitted+stats.draft)} att granska</span></span><span className="font-semibold tabular-nums">{formatMinutes(stats.total)}</span><ChevronRight className="h-4 w-4"/></button>;})}</div>
        {staffWithEntries.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="w-12 h-12" />}
            title={timeEntries.length?'Inga medarbetare matchar':'Inga tidposter'}
            description={timeEntries.length?'Ändra sökning eller filter.':'Ingen data för vald månad.'}
          />
        ) : (
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Namn</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Totalt</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Godkänd</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Inlämnad</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Utkast</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-slate-700">Avvisad</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-slate-700">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffWithEntries.map((userProfile) => {
                    const stats = calculateStats(getEntriesForUser(userProfile.id));
                    return (
                      <tr key={userProfile.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-3 px-4 font-medium text-slate-900">{userProfile.name}</td>
                        <td className="py-3 px-4 text-sm font-semibold text-slate-800">
                          {formatMinutes(stats.total)}
                        </td>
                        <td className="py-3 px-4">
                          <span className="tabular-nums text-vihem-muted">{formatMinutes(stats.approved)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="tabular-nums text-vihem-muted">{formatMinutes(stats.submitted)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="tabular-nums text-vihem-muted">{formatMinutes(stats.draft)}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className="tabular-nums text-vihem-muted">{formatMinutes(stats.rejected)}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => { setSelectedUser(userProfile); setShowDetailModal(true);setActionError(''); }}
                            className="text-blue-600 hover:text-blue-700 font-medium text-sm inline-flex items-center gap-1"
                          >
                            Detaljer
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Modal mobileFullscreen
        open={showDetailModal}
        onClose={() => { if(pending)return;setShowDetailModal(false); setSelectedUser(null);setActionError(''); }}
        title={`Tidposter — ${selectedUser?.name}`}
        size="lg"
        toolbar={actionError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
        footer={<><Button variant="secondary" disabled={pending} onClick={()=>setShowDetailModal(false)}>Stäng</Button><Button disabled={!selectedUser||!getEntriesForUser(selectedUser.id).some(e=>e.status!=='approved')} loading={pending} onClick={()=>setConfirmAll(true)}>Godkänn alla</Button></>}
      >
        <div className="divide-y divide-vihem-line">
          {selectedUser && getEntriesForUser(selectedUser.id).map((entry) => (
            <div key={entry.id} className="py-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-slate-900 text-sm">
                    {formatDateTime(entry.start_time)}
                  </p>
                  {entry.end_time && (
                    <p className="text-xs text-slate-500">
                      {new Date(entry.start_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                      {' — '}
                      {new Date(entry.end_time).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <Badge className={TIME_STATUS_COLORS[entry.status] || 'text-slate-600 bg-slate-100'}>
                  {TIME_STATUS_LABELS[entry.status] || entry.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
                <div>
                  <span className="text-slate-500">Kategori</span>
                  <p className="font-medium text-slate-800">
                    {labelFor(entry.category)}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Timmar</span>
                  <p className="font-medium text-slate-800">{formatMinutes(entry.total_minutes || 0)}</p>
                </div>
              </div>

              {entry.comment && (
                <p className="text-sm text-slate-600 mb-3">{entry.comment}</p>
              )}

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                {entry.status !== 'approved' && (
                  <Button size="sm" variant="primary" disabled={pending} onClick={() => void changeStatus([entry.id],'approved')} className="gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Godkänn
                  </Button>
                )}
                {entry.status !== 'rejected' && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => void changeStatus([entry.id],'rejected')} className="gap-1">
                    <XCircle className="w-3 h-3" />
                    Avvisa
                  </Button>
                )}
              </div>
            </div>
          ))}

        </div>
      </Modal>
      <Modal open={confirmAll} onClose={()=>{if(!pending)setConfirmAll(false);}} title="Godkänn månadens tidposter?" footer={<><Button variant="secondary" disabled={pending} onClick={()=>setConfirmAll(false)}>Avbryt</Button><Button loading={pending} onClick={()=>selectedUser&&void changeStatus(getEntriesForUser(selectedUser.id).filter(e=>e.status!=='approved').map(e=>e.id),'approved')}>Godkänn tidposter</Button></>}><p>{selectedUser?.name} · {selectedMonth}. Även utkast och tidigare avvisade tidposter ingår enligt den befintliga funktionen. Granska underlaget först.</p>{actionError&&<p role="alert">{actionError}</p>}</Modal>
    </div>
  );
}
