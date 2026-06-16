import React, { useState, useEffect } from 'react';
import { BarChart3, Calendar, Download, CheckCircle, XCircle, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  Card,
  Badge,
  Button,
  Modal,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatMinutes, TIME_CATEGORY_LABELS, formatDateTime } from '../lib/utils';
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
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [year, month] = selectedMonth.split('-');
      const startOfMonth = `${year}-${month}-01`;
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

      const [entriesRes, profilesRes] = await Promise.all([
        supabase
          .from('vihem_time_entries')
          .select('*')
          .gte('start_time', `${startOfMonth}T00:00:00`)
          .lte('start_time', `${endOfMonth}T23:59:59`)
          .order('start_time', { ascending: false }),
        supabase
          .from('vihem_profiles')
          .select('*')
          .in('role', ['staff', 'admin'])
          .order('name'),
      ]);

      if (entriesRes.data) setTimeEntries(entriesRes.data);
      if (profilesRes.data) setProfiles(profilesRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

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

  const handleApproveAll = async (userId: string) => {
    try {
      const entries = getEntriesForUser(userId).filter((e) => e.status !== 'approved');
      for (const entry of entries) {
        await supabase.from('vihem_time_entries').update({ status: 'approved' }).eq('id', entry.id);
      }
      fetchData();
    } catch (error) {
      console.error('Error approving entries:', error);
    }
  };

  const handleApproveEntry = async (entryId: string) => {
    try {
      await supabase.from('vihem_time_entries').update({ status: 'approved' }).eq('id', entryId);
      fetchData();
    } catch (error) {
      console.error('Error approving entry:', error);
    }
  };

  const handleRejectEntry = async (entryId: string) => {
    try {
      await supabase.from('vihem_time_entries').update({ status: 'rejected' }).eq('id', entryId);
      fetchData();
    } catch (error) {
      console.error('Error rejecting entry:', error);
    }
  };

  if (loading) return <LoadingPage />;

  const staffWithEntries = profiles.filter((p) => getEntriesForUser(p.id).length > 0);
  const allStats = getAllStats();

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title="Löneöversikt"
          subtitle="Översikt över timmar och tidposter per månad"
        />

        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-slate-500" />
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => alert('Exportfunktion ej implementerad')}
          >
            <Download className="w-4 h-4" />
            Exportera
          </Button>
        </div>

        {/* Summary cards */}
        {staffWithEntries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card className="p-5">
              <p className="text-sm text-slate-500 mb-1">Totalt timmar (all personal)</p>
              <p className="text-2xl font-bold text-slate-900">{formatMinutes(allStats.total)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-slate-500 mb-1">Godkända timmar</p>
              <p className="text-2xl font-bold text-green-700">{formatMinutes(allStats.approved)}</p>
            </Card>
            <Card className="p-5">
              <p className="text-sm text-slate-500 mb-1">Väntande timmar</p>
              <p className="text-2xl font-bold text-blue-700">{formatMinutes(allStats.submitted + allStats.draft)}</p>
            </Card>
          </div>
        )}

        {staffWithEntries.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="w-12 h-12" />}
            title="Inga tidposter"
            description="Ingen data för vald månad"
          />
        ) : (
          <Card>
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
                          <Badge className="text-green-700 bg-green-100">
                            {formatMinutes(stats.approved)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className="text-blue-700 bg-blue-100">
                            {formatMinutes(stats.submitted)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className="text-slate-600 bg-slate-100">
                            {formatMinutes(stats.draft)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge className="text-red-700 bg-red-100">
                            {formatMinutes(stats.rejected)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => { setSelectedUser(userProfile); setShowDetailModal(true); }}
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

      <Modal
        open={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedUser(null); }}
        title={`Tidposter — ${selectedUser?.name}`}
        size="lg"
      >
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {selectedUser && getEntriesForUser(selectedUser.id).map((entry) => (
            <div key={entry.id} className="border border-slate-200 rounded-lg p-4">
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
                    {TIME_CATEGORY_LABELS[entry.category as keyof typeof TIME_CATEGORY_LABELS] || entry.category}
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
                  <Button size="sm" variant="primary" onClick={() => handleApproveEntry(entry.id)} className="gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Godkänn
                  </Button>
                )}
                {entry.status !== 'rejected' && (
                  <Button size="sm" variant="secondary" onClick={() => handleRejectEntry(entry.id)} className="gap-1">
                    <XCircle className="w-3 h-3" />
                    Avvisa
                  </Button>
                )}
              </div>
            </div>
          ))}

          {selectedUser && (
            <div className="pt-2 border-t border-slate-200 sticky bottom-0 bg-white pb-1">
              <Button
                variant="primary"
                onClick={() => handleApproveAll(selectedUser.id)}
                className="w-full gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Godkänn alla
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
