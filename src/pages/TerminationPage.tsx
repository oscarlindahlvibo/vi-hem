import React, { useState, useEffect, useRef } from 'react';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  Card,
  Badge,
  Button,
  Input,
  Textarea,
  PageHeader,
  EmptyState,
  LoadingPage,
} from '../components/ui';
import { formatDate, TERMINATION_STATUS_LABELS } from '../lib/utils';
import { TerminationRequest, Tenancy } from '../types';
import {
  FileX,
  Calendar,
  Home,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';

interface TerminationPageProps { onNavigate: (page: string) => void; }
export function TerminationPage({ onNavigate: _onNavigate }: TerminationPageProps) {
  const { user } = useAuth();

  // Termination requests state
  const [terminationRequests, setTerminationRequests] = useState<
    TerminationRequest[]
  >([]);

  // Current tenancy state
  const [activeTenancy, setActiveTenancy] = useState<Tenancy | null>(null);

  // Form state
  const [requestMoveOutDate, setRequestMoveOutDate] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [message, setMessage] = useState('');
  const [isConfirmed, setIsConfirmed] = useState(false);

  // UI state
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [error, setError] = useState('');
  const submitLock = useRef(false);
  useUnsavedChanges({ requestMoveOutDate, newAddress, message, isConfirmed }, !showSuccess && !submitting);

  // Get min date (today + 3 months)
  const getMinDate = () => {
    const today = new Date();
    const minDate = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate());
    return `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2, '0')}-${String(minDate.getDate()).padStart(2, '0')}`;
  };

  // Check if user has an active/pending termination request
  const hasActivePendingRequest = () => {
    return terminationRequests.some(
      (req) => req.status === 'submitted' || req.status === 'received' || req.status === 'processing'
    );
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      submitted: 'text-blue-600 bg-blue-100',
      received: 'text-teal-600 bg-teal-100',
      processing: 'text-amber-600 bg-amber-100',
      approved: 'text-green-600 bg-green-100',
      closed: 'text-slate-600 bg-slate-100',
    };
    return colors[status] || 'text-slate-600 bg-slate-100';
  };

  useEffect(() => {
    if (user?.id) {
      fetchData();
    }
  }, [user?.id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      await Promise.all([
        fetchTerminationRequests(),
        fetchActiveTenancy(),
      ]);
    } catch (error) {
      setError('Kunde inte hämta ditt avtal och dina uppsägningar. Försök igen.');
    } finally {
      setLoading(false);
    }
  };

  const fetchTerminationRequests = async () => {
      const { data, error } = await supabase
        .from('vihem_termination_requests')
        .select('*, tenancy:vihem_tenancies(*, apartment:vihem_apartments(*, property:vihem_properties(*)))')
        .eq('tenant_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTerminationRequests(data || []);
  };

  const fetchActiveTenancy = async () => {
      const { data, error } = await supabase
        .from('vihem_tenancies')
        .select('*, apartment:vihem_apartments(*, property:vihem_properties(*))')
        .eq('tenant_id', user?.id)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setActiveTenancy(data || null);
  };

  const handleSubmitTerminationRequest = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConfirmed || !activeTenancy || submitLock.current || hasActivePendingRequest()) return;
    submitLock.current = true;
    setError('');

    try {
      setSubmitting(true);

      const { data: savedRequest, error } = await supabase.from('vihem_termination_requests').insert([
        {
          organisation_id: user?.organisation_id,
          tenant_id: user?.id,
          tenancy_id: activeTenancy.id,
          requested_move_out_date: requestMoveOutDate,
          new_address: newAddress,
          message: message || null,
          status: 'submitted',
        },
      ]).select().single();

      if (error) throw error;
      setTerminationRequests(current => [savedRequest as TerminationRequest, ...current]);

      // Reset form
      setRequestMoveOutDate('');
      setNewAddress('');
      setMessage('');
      setIsConfirmed(false);

      // Show success message
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 5000);

      // Refresh data
      try { await fetchTerminationRequests(); } catch { setError('Uppsägningen är skickad, men historiken kunde inte uppdateras. Hämta igen.'); }
    } catch (error) {
      setError('Kunde inte skicka uppsägningen. Dina uppgifter finns kvar. Kontrollera anslutningen och försök igen.');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingPage />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <PageHeader
          title="Uppsägning av avtal"
          subtitle="Hantera dina hyresavtal och uppsägningar"
        />

        {error && <div role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}<Button type="button" variant="ghost" onClick={fetchData}>Hämta igen</Button></div>}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Success Message */}
        {showSuccess && (
          <Card className="mb-6 p-4 bg-green-50 border-green-200">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-green-800">Uppsägning skickad</h3>
                <p className="text-sm text-green-700 mt-1">
                  Din uppsägning har skickats in och är under handläggning.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Section 1: History of Termination Requests */}
        <section className="order-2 lg:col-start-2 lg:row-start-1">
          <div className="flex items-center gap-2 mb-4">
            <FileX className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-800">Mina uppsägningar</h2>
          </div>

          {terminationRequests.length === 0 ? (
            <p className="text-sm text-slate-500">Här visas din uppsägning och handläggningsstatus när du har skickat in den.</p>
          ) : (
            <div className="grid gap-4">
              {terminationRequests.map((request) => (
                <Card key={request.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">
                          Önskad utflyttning:{' '}
                          <span className="font-semibold">
                            {formatDate(request.requested_move_out_date)}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mb-3">
                        <Badge className={getStatusColor(request.status)}>
                          {TERMINATION_STATUS_LABELS[request.status as keyof typeof TERMINATION_STATUS_LABELS]}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          Inlämnad: {formatDate(request.created_at)}
                        </span>
                      </div>

                      {request.message && (
                        <p className="text-sm text-slate-600 whitespace-pre-wrap break-words">
                          {request.message}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Termination Form */}
        {activeTenancy ? (
          <section className="order-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Säg upp avtal</h2>

            {/* Current Tenancy Info */}
            <div className="mb-5 border-b border-slate-200 pb-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Lägenhet</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">
                    {activeTenancy.apartment?.apartment_number || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Adress</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">
                    {activeTenancy.apartment?.property?.address || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase">Månadshyra</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">
                    {activeTenancy.monthly_rent?.toLocaleString('sv-SE', {
                      style: 'currency',
                      currency: 'SEK',
                      maximumFractionDigits: 0,
                    }) || 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            {/* Warning Notice */}
            <Card className="p-4 mb-6 bg-amber-50 border-amber-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-amber-900">Bindande uppsägning</h3>
                  <p className="text-sm text-amber-800 mt-1">
                    En uppsägning är bindande. Normalt hyresavtal har 3 månaders uppsägningstid.
                  </p>
                </div>
              </div>
            </Card>

            {/* Active/Pending Request Notice */}
            {hasActivePendingRequest() ? (
              <Card className="p-4 mb-6 bg-blue-50 border-blue-200">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-blue-900">Aktiv uppsägning</h3>
                    <p className="text-sm text-blue-800 mt-1">
                      Du har redan en aktiv uppsägning under handläggning. Du kan inte skicka en ny
                      uppsägning just nu.
                    </p>
                  </div>
                </div>
              </Card>
            ) : (
              <form onSubmit={handleSubmitTerminationRequest}>
                <div className="space-y-5 mb-6">
                  <Input
                    label="Önskat utflyttningsdatum"
                    type="date"
                    value={requestMoveOutDate}
                    onChange={(e) => setRequestMoveOutDate(e.target.value)}
                    min={getMinDate()}
                    required
                    hint="Minst 3 månader från idag"
                  />

                  <Input
                    label="Din nya adress"
                    type="text"
                    placeholder="Gata, hus, lägenhetsnummer, stad"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    required
                  />

                  <Textarea
                    label="Meddelande (valfritt)"
                    placeholder="Lägg till någon anledning eller ytterligare information..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={3}
                  />
                </div>

                {/* Confirmation Checkbox */}
                <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="confirm-termination"
                      checked={isConfirmed}
                      onChange={(e) => setIsConfirmed(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                      htmlFor="confirm-termination"
                      className="text-sm text-slate-700 cursor-pointer"
                    >
                      Jag förstår att denna uppsägning är bindande och att normal uppsägningstid
                      gäller.
                    </label>
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={!isConfirmed || submitting}
                  loading={submitting}
                  className="w-full"
                >
                  {submitting ? 'Skickar...' : 'Skicka uppsägning'}
                </Button>
              </form>
            )}
          </section>
        ) : (
          <Card className="p-8 bg-slate-50 border-slate-300">
            <div className="flex items-start gap-4">
              <Home className="w-6 h-6 text-slate-400 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-medium text-slate-800">Inget aktivt hyresavtal</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Du har inget aktivt hyresavtal. Du kan bara säga upp avtal om du har ett aktivt
                  hyresavtal.
                </p>
              </div>
            </div>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
