import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Card, Badge, StatCard, LoadingPage } from '../components/ui';
import { formatDate, formatDateTime, MR_STATUS_LABELS, getMRStatusColor, WO_STATUS_LABELS, getWOStatusColor, getWOPriorityColor, WO_PRIORITY_LABELS } from '../lib/utils';
import type { MaintenanceRequest, WorkOrder, TimeEntry } from '../types';
import { Wrench, ClipboardList, Clock, AlertCircle, CheckCircle, Timer, Plus, ArrowRight } from 'lucide-react';

interface StaffDashboardProps {
  onNavigate: (page: string) => void;
}

export function StaffDashboard({ onNavigate }: StaffDashboardProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [newMRCount, setNewMRCount] = useState(0);
  const [urgentMRCount, setUrgentMRCount] = useState(0);
  const [myWorkOrdersCount, setMyWorkOrdersCount] = useState(0);
  const [newWorkOrdersCount, setNewWorkOrdersCount] = useState(0);
  const [activeTimeEntry, setActiveTimeEntry] = useState<TimeEntry | null>(null);
  const [myWorkOrders, setMyWorkOrders] = useState<WorkOrder[]>([]);
  const [newWorkOrders, setNewWorkOrders] = useState<WorkOrder[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    const fetchDashboardData = async () => {
      try {
        setLoading(true);

        const [
          newMRResult,
          urgentMRResult,
          myWOResult,
          newWOResult,
          activeTimeResult,
          myWODetailsResult,
          newWODetailsResult,
        ] = await Promise.all([
          // Count new maintenance requests (status='received')
          supabase
            .from('maintenance_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'received'),

          // Count urgent maintenance requests (priority='urgent' and status not in 'done','closed')
          supabase
            .from('maintenance_requests')
            .select('id', { count: 'exact', head: true })
            .eq('priority', 'urgent')
            .not('status', 'in', '(done,closed)'),

          // Count my assigned work orders, including multi-assignee rows.
          supabase
            .from('work_orders')
            .select('id', { count: 'exact', head: true })
            .or(`assigned_to.eq.${user.id},assigned_to_ids.cs.{${user.id}}`)
            .not('status', 'in', '(completed,cancelled)'),

          // Count new work orders (status='new')
          supabase
            .from('work_orders')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'new'),

          // Fetch today's active time entry (start_time today, end_time is null)
          supabase
            .from('time_entries')
            .select('*')
            .eq('user_id', user.id)
            .is('end_time', null)
            .gte('start_time', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
            .order('start_time', { ascending: false })
            .limit(1),

          // Fetch my assigned work orders (limit 5)
          supabase
            .from('work_orders')
            .select('*')
            .or(`assigned_to.eq.${user.id},assigned_to_ids.cs.{${user.id}}`)
            .not('status', 'in', '(completed,cancelled)')
            .order('due_date', { ascending: true, nullsFirst: true })
            .limit(5),

          // Fetch new work orders (limit 5)
          supabase
            .from('work_orders')
            .select('*')
            .eq('status', 'new')
            .order('created_at', { ascending: false })
            .limit(5),
        ]);

        setNewMRCount(newMRResult.count || 0);
        setUrgentMRCount(urgentMRResult.count || 0);
        setMyWorkOrdersCount(myWOResult.count || 0);
        setNewWorkOrdersCount(newWOResult.count || 0);

        if (activeTimeResult.data && activeTimeResult.data.length > 0) {
          setActiveTimeEntry(activeTimeResult.data[0]);
        }

        if (myWODetailsResult.data) {
          setMyWorkOrders(myWODetailsResult.data);
        }

        if (newWODetailsResult.data) {
          setNewWorkOrders(newWODetailsResult.data);
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user?.id]);

  if (loading) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Nya felanmälningar"
          value={newMRCount}
          icon={<AlertCircle className="w-6 h-6" />}
          color="text-red-600 bg-red-50"
          onClick={() => onNavigate('maintenance')}
        />
        <StatCard
          label="Akuta ärenden"
          value={urgentMRCount}
          icon={<Wrench className="w-6 h-6" />}
          color="text-orange-600 bg-orange-50"
        />
        <StatCard
          label="Mina arbetsordrar"
          value={myWorkOrdersCount}
          icon={<ClipboardList className="w-6 h-6" />}
          color="text-blue-600 bg-blue-50"
          onClick={() => onNavigate('workorders')}
        />
        <StatCard
          label="Nya arbetsordrar"
          value={newWorkOrdersCount}
          icon={<Plus className="w-6 h-6" />}
          color="text-green-600 bg-green-50"
        />
      </div>

      {/* Active Time Entry Card */}
      {activeTimeEntry && (
        <Card className="p-6 border-2 border-blue-200 bg-blue-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-600 text-white">
                <Timer className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Pågående tidsstämpling</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Startad: {formatDateTime(activeTimeEntry.start_time)}
                </p>
              </div>
            </div>
            <button
              onClick={() => onNavigate('timetracking')}
              className="inline-flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Stämpla ut
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </Card>
      )}

      {/* My Assigned Work Orders */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Mina tilldelade arbetsordrar</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {myWorkOrders.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500">Inga tilldelade arbetsordrar</p>
            </div>
          ) : (
            myWorkOrders.map((wo) => (
              <div
                key={wo.id}
                className="px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => onNavigate(`workorder/${wo.id}`)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-800 truncate">{wo.title}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={getWOPriorityColor(wo.priority)}>
                        {WO_PRIORITY_LABELS[wo.priority]}
                      </Badge>
                      <Badge className={getWOStatusColor(wo.status)}>
                        {WO_STATUS_LABELS[wo.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    {wo.due_date ? (
                      <div>
                        <p className="font-medium text-slate-700">{formatDate(wo.due_date)}</p>
                        <p className="text-xs text-slate-500">Förfallet</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Inget datum</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* New Work Orders */}
      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Nya arbetsordrar</h2>
        </div>
        <div className="divide-y divide-slate-200">
          {newWorkOrders.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-slate-500">Inga nya arbetsordrar</p>
            </div>
          ) : (
            newWorkOrders.map((wo) => (
              <div
                key={wo.id}
                className="px-6 py-4 hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => onNavigate(`workorder/${wo.id}`)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-slate-800 truncate">{wo.title}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={getWOPriorityColor(wo.priority)}>
                        {WO_PRIORITY_LABELS[wo.priority]}
                      </Badge>
                      <Badge className={getWOStatusColor(wo.status)}>
                        {WO_STATUS_LABELS[wo.status]}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right text-sm text-slate-600">
                    {wo.due_date ? (
                      <div>
                        <p className="font-medium text-slate-700">{formatDate(wo.due_date)}</p>
                        <p className="text-xs text-slate-500">Förfallet</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Inget datum</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => onNavigate('workorders')}
          className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-100 text-blue-600">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Ny arbetsorder</h4>
              <p className="text-xs text-slate-500">Skapa en ny</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => onNavigate('maintenance')}
          className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-red-100 text-red-600">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Felanmälningar</h4>
              <p className="text-xs text-slate-500">Se alla ärenden</p>
            </div>
          </div>
        </button>
        <button
          onClick={() => onNavigate('timetracking')}
          className="p-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-green-100 text-green-600">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Tidrapportering</h4>
              <p className="text-xs text-slate-500">Rapportera tid</p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
