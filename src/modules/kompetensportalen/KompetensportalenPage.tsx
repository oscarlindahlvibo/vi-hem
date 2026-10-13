import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingPage, PageHeader, Tabs } from '../../components/ui';
import { db } from './api';
import { OverviewTab } from './OverviewTab';
import { CoursesTab } from './CoursesTab';
import { BuilderTab } from './BuilderTab';
import { SessionsTab } from './SessionsTab';
import { OrdersTab } from './OrdersTab';
import { CustomersTab } from './CustomersTab';
import { ParticipantsTab } from './ParticipantsTab';
import { QuestionsTab } from './QuestionsTab';
import { CertificatesTab } from './CertificatesTab';
import { Id06Tab } from './Id06Tab';
import { ContentTab } from './ContentTab';
import { SettingsTab } from './SettingsTab';

const TABS = [
  ['overview', 'Översikt'], ['courses', 'Kurser'], ['builder', 'Kursbyggare'], ['sessions', 'Kurstillfällen'], ['orders', 'Ordrar & betalningar'], ['customers', 'Företagskunder'],
  ['participants', 'Deltagare'], ['questions', 'Quiz & prov'], ['certificates', 'Certifikat'], ['id06', 'ID06'], ['content', 'Webbplats'], ['settings', 'Inställningar'],
] as const;

export function KompetensportalenPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<string>(() => localStorage.getItem('kp-admin-tab') || 'overview');
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [builderCourse, setBuilderCourse] = useState<string>('');
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const load = async () => { const { data } = await db.from('vihem_kp_settings').select('*').maybeSingle(); setSettings(data); setLoading(false); };
  useEffect(() => { void load(); }, []);
  useEffect(() => { try { localStorage.setItem('kp-admin-tab', tab); } catch { /* ignorera */ } }, [tab]);
  if (loading) return <LoadingPage />;
  const organisationId = user?.organisation_id as string;
  const props = { organisationId, isAdmin, settings, reloadSettings: load };
  return (
    <div className="space-y-5">
      <PageHeader title="Kompetensportalen" subtitle="Kurser, order, deltagare, prov och certifikat för WPE Sweden AB – separat från fastighetsförvaltningen." icon={GraduationCap} />
      {!settings && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Modulen är inte konfigurerad. Be en administratör köra grundinställningarna under Inställningar.</p>}
      <Tabs tabs={TABS.map(([key, label]) => ({ key, label }))} active={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab {...props} />}
      {tab === 'courses' && <CoursesTab {...props} onOpenBuilder={(id) => { setBuilderCourse(id); setTab('builder'); }} />}
      {tab === 'builder' && <BuilderTab {...props} initialCourse={builderCourse} />}
      {tab === 'sessions' && <SessionsTab {...props} />}
      {tab === 'orders' && <OrdersTab {...props} />}
      {tab === 'customers' && <CustomersTab {...props} />}
      {tab === 'participants' && <ParticipantsTab {...props} />}
      {tab === 'questions' && <QuestionsTab {...props} />}
      {tab === 'certificates' && <CertificatesTab {...props} />}
      {tab === 'id06' && <Id06Tab {...props} />}
      {tab === 'content' && <ContentTab {...props} />}
      {tab === 'settings' && <SettingsTab {...props} />}
    </div>
  );
}
export type TabProps = { organisationId: string; isAdmin: boolean; settings: any; reloadSettings: () => Promise<void> };
