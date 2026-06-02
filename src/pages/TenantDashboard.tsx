import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge, StatCard, LoadingPage } from '../components/ui';
import { formatDate, formatCurrency, MR_STATUS_LABELS } from '../lib/utils';
import type { Tenancy, MaintenanceRequest, LaundryBooking, News } from '../types';
import {
  Home,
  Wrench,
  WashingMachine,
  FileText,
  Newspaper,
  ArrowRight,
  AlertCircle,
  CheckCircle,
  Clock,
  PenLine,
  MessageCircle,
} from 'lucide-react';

interface TenantDashboardProps {
  onNavigate: (page: string) => void;
}

interface TenantData {
  tenancy: (Tenancy & {
    apartment: { apartment_number: string } | null;
    property: { address: string; name: string } | null;
  }) | null;
  maintenanceRequests: MaintenanceRequest[];
  laundryBookings: (LaundryBooking & {
    slot: { date: string; start_time: string; room_name: string } | null;
  })[];
  news: News[];
  pendingContracts: { id: string; created_at: string }[];
  loading: boolean;
  error: string | null;
}

export const TenantDashboard: React.FC<TenantDashboardProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [data, setData] = useState<TenantData>({
    tenancy: null,
    maintenanceRequests: [],
    laundryBookings: [],
    news: [],
    pendingContracts: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!user?.id) return;

    const fetchDashboardData = async () => {
      try {
        const { data: tenancyData, error: tenancyError } = await supabase
          .from('tenancies')
          .select('*, apartment:apartments(apartment_number), property:properties(address, name)')
          .eq('tenant_id', user.id)
          .eq('status', 'active')
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tenancyError) throw tenancyError;

        const [mrRes, laundryRes, newsRes, contractRes] = await Promise.all([
          supabase
            .from('maintenance_requests')
            .select('*')
            .eq('tenant_id', user.id)
            .order('created_at', { ascending: false })
            .limit(3),
          supabase
            .from('laundry_bookings')
            .select('*, slot:laundry_slots(date, start_time, end_time)')
            .eq('tenant_id', user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false }),
          supabase
            .from('news')
            .select('*')
            .eq('status', 'published')
            .order('published_at', { ascending: false })
            .limit(3),
          tenancyData
            ? supabase
                .from('contract_signatures')
                .select('id, created_at')
                .eq('tenancy_id', tenancyData.id)
                .eq('status', 'pending_tenant')
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (mrRes.error) console.error('Error fetching tenant maintenance requests:', mrRes.error);
        if (laundryRes.error) console.error('Error fetching tenant laundry bookings:', laundryRes.error);
        if (newsRes.error) console.error('Error fetching tenant news:', newsRes.error);
        if (contractRes.error) console.error('Error fetching tenant pending contracts:', contractRes.error);

        setData({
          tenancy: tenancyData,
          maintenanceRequests: mrRes.error ? [] : mrRes.data || [],
          laundryBookings: laundryRes.error ? [] : laundryRes.data || [],
          news: newsRes.error ? [] : newsRes.data || [],
          pendingContracts: contractRes.error ? [] : contractRes.data || [],
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setData((prev) => ({
          ...prev,
          loading: false,
          error: 'Kunde inte hämta instrumentpanelsdata. Försök igen senare.',
        }));
      }
    };

    fetchDashboardData();
  }, [user?.id]);

  if (data.loading) return <LoadingPage />;

  if (data.error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-6xl mx-auto">
          <Card className="border-red-200 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-6 w-6 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900">Fel vid inläsning</h3>
                <p className="text-red-800 mt-1">{data.error}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const tenantName = user?.name || 'Hyresgäst';
  const apartmentNumber = (data.tenancy?.apartment as any)?.apartment_number || '—';
  const propertyName = (data.tenancy?.property as any)?.name || '—';
  const propertyAddress = (data.tenancy?.property as any)?.address || '—';

  const today = new Date();
  const nextDueDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  const monthlyRent = data.tenancy?.monthly_rent || 0;
  const openMR = data.maintenanceRequests.filter(
    (mr) => mr.status !== 'done' && mr.status !== 'closed'
  ).length;

  const getMRStatusBadgeClass = (status: string) => {
    const map: Record<string, string> = {
      received: 'bg-blue-100 text-blue-700',
      assigned: 'bg-amber-100 text-amber-700',
      started: 'bg-orange-100 text-orange-700',
      waiting_material: 'bg-yellow-100 text-yellow-700',
      waiting_contractor: 'bg-yellow-100 text-yellow-700',
      done: 'bg-green-100 text-green-700',
      closed: 'bg-slate-100 text-slate-600',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
  };

  const getStatusIcon = (status: string) => {
    if (status === 'done' || status === 'closed') return <CheckCircle className="h-5 w-5 text-green-600" />;
    if (status === 'started') return <Clock className="h-5 w-5 text-yellow-600" />;
    return <AlertCircle className="h-5 w-5 text-red-600" />;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-1 break-words">Hej, {tenantName}!</h1>
              <p className="text-sm sm:text-base text-slate-500 leading-relaxed break-words">
                {propertyName} &mdash; Lägenhet {apartmentNumber} &mdash; {propertyAddress}
              </p>
            </div>
            <div className="w-11 h-11 sm:w-12 sm:h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Home className="h-6 w-6 text-blue-600" />
            </div>
          </div>

          {/* Pending contract alert — shown above everything else when relevant */}
          {data.pendingContracts.length > 0 && (
            <button
              onClick={() => onNavigate('apartment')}
              className="w-full mb-6 flex items-start justify-between gap-3 bg-amber-50 border-2 border-amber-300 rounded-xl px-4 sm:px-5 py-4 hover:bg-amber-100 transition-colors text-left group"
            >
              <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                <div className="w-10 h-10 bg-amber-200 rounded-xl flex items-center justify-center flex-shrink-0">
                  <PenLine className="h-5 w-5 text-amber-800" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-amber-900">
                    {data.pendingContracts.length === 1
                      ? 'Du har ett hyresavtal som väntar på din signatur'
                      : `Du har ${data.pendingContracts.length} hyresavtal som väntar på din signatur`}
                  </p>
                  <p className="text-sm text-amber-700 mt-0.5">
                    Gå till Min lägenhet för att granska och signera avtalet.
                  </p>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-amber-600 flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              label="Månadshyra"
              value={formatCurrency(monthlyRent)}
              icon={<FileText className="h-5 w-5" />}
            />
            <StatCard
              label="Nästa förfallodatum"
              value={formatDate(nextDueDate)}
              icon={<Clock className="h-5 w-5" />}
            />
            <StatCard
              label="Öppna felanmälningar"
              value={openMR}
              icon={<Wrench className="h-5 w-5" />}
            />
            <StatCard
              label="Bokade tvätttider"
              value={data.laundryBookings.length}
              icon={<WashingMachine className="h-5 w-5" />}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Maintenance Requests */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-slate-900">Mina felanmälningar</h2>
                </div>
                <button
                  onClick={() => onNavigate('maintenance')}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                >
                  Visa alla <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {data.maintenanceRequests.length === 0 ? (
                <Card className="p-6">
                  <div className="text-center py-4">
                    <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
                    <p className="text-slate-700 font-medium">Inga aktiva felanmälningar</p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {data.maintenanceRequests.map((mr) => (
                    <Card
                      key={mr.id}
                      className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => onNavigate('maintenance')}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {getStatusIcon(mr.status)}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-slate-900 truncate">{mr.title}</h3>
                            <p className="text-xs text-slate-500 mt-1">{formatDate(new Date(mr.created_at))}</p>
                          </div>
                        </div>
                        <Badge className={`${getMRStatusBadgeClass(mr.status)} self-start`}>
                          {MR_STATUS_LABELS[mr.status as keyof typeof MR_STATUS_LABELS] || mr.status}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Laundry Bookings */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <WashingMachine className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-slate-900">Kommande tvätttider</h2>
                </div>
                <button
                  onClick={() => onNavigate('laundry')}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                >
                  Boka tid <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {data.laundryBookings.length === 0 ? (
                <Card className="p-6">
                  <div className="text-center py-4">
                    <WashingMachine className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-600 font-medium text-sm">Inga bokade tvätttider</p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {data.laundryBookings.map((booking) => (
                    <Card
                      key={booking.id}
                      className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                      onClick={() => onNavigate('laundry')}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Clock className="h-5 w-5 text-blue-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 text-sm">Tvätttid bokad</p>
                            {(booking.slot as any)?.date && (
                              <p className="text-xs text-slate-500 break-words">
                                {formatDate(new Date((booking.slot as any).date))}
                                {(booking.slot as any)?.start_time && ` • ${(booking.slot as any).start_time}`}
                              </p>
                            )}
                          </div>
                        </div>
                        <Badge className="bg-green-100 text-green-700 self-start sm:self-auto">Bokad</Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* News */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Newspaper className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-900">Nyheter</h2>
              </div>

              {data.news.length === 0 ? (
                <Card className="p-5">
                  <div className="text-center py-3">
                    <Newspaper className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-500 text-sm">Inga nyheter</p>
                  </div>
                </Card>
              ) : (
                <div className="space-y-3">
                  {data.news.map((item) => (
                    <Card key={item.id} className="p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => onNavigate('news')}>
                      <h3 className="font-semibold text-slate-900 text-sm line-clamp-2">{item.title}</h3>
                      {item.published_at && (
                        <p className="text-xs text-slate-400 mt-1">{formatDate(new Date(item.published_at))}</p>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </section>

            {/* Quick Actions */}
            <section>
              <h3 className="text-base font-bold text-slate-900 mb-3">Snabbåtgärder</h3>
              <div className="space-y-2">
                <button
                  onClick={() => onNavigate('maintenance')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    <span>Ny felanmälan</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onNavigate('laundry')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors text-sm"
                >
                  <div className="flex items-center gap-2">
                    <WashingMachine className="h-4 w-4" />
                    <span>Boka tvätt</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onNavigate('documents')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-medium transition-colors text-sm"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span>Dokument</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onNavigate('chat')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-medium transition-colors text-sm"
                >
                  <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    <span>Chatt</span>
                  </div>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TenantDashboard;
