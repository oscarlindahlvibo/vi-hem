import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Modal, Button } from './ui';
import { defaultNotificationSettings, NOTIFICATION_SETTING_LABELS, type NotificationSettings, type BooleanNotificationSettingKey } from '../lib/utils';

interface NotificationSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Per-user overrides on top of the organisation's notification defaults
 * (AdminStaffPage.tsx). A key left untouched here just falls through to
 * the org setting -- see notification_enabled_for_user() in
 * supabase/migrations/20260831110000_user_notification_settings.sql.
 */
export function NotificationSettingsModal({ open, onClose }: NotificationSettingsModalProps) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadSettings() {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchError } = await supabase
        .from('vihem_user_notification_settings')
        .select('settings')
        .eq('user_id', user.id)
        .maybeSingle();
      if (fetchError) throw fetchError;
      setSettings({ ...defaultNotificationSettings, ...(data?.settings || {}) });
    } catch (err: any) {
      setError(err.message || 'Kunde inte läsa notisinställningarna.');
    } finally {
      setLoading(false);
    }
  }

  function updateSetting(key: BooleanNotificationSettingKey, value: boolean) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const { error: saveError } = await supabase
        .from('vihem_user_notification_settings')
        .upsert({
          user_id: user.id,
          organisation_id: user.organisation_id,
          settings,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      if (saveError) throw saveError;
      onClose();
    } catch (err: any) {
      setError(err.message || 'Kunde inte spara notisinställningarna.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Notisinställningar" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Stäng av notistyper du inte vill ha. En avstängd typ syns varken i notislistan eller som push till din telefon för dig -- andra i organisationen påverkas inte.
        </p>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500">
            <Bell className="mr-2 h-4 w-4 animate-pulse" /> Läser inställningar...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {NOTIFICATION_SETTING_LABELS.map((setting) => (
              <label key={setting.key} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={Boolean(settings[setting.key])}
                  onChange={(event) => updateSetting(setting.key, event.target.checked)}
                  className="mt-1 rounded border-slate-300 accent-blue-600"
                />
                <span>
                  <span className="block text-sm font-medium text-slate-800">{setting.label}</span>
                  <span className="block text-xs text-slate-500">{setting.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Stäng</Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={loading}>
            Spara
          </Button>
        </div>
      </div>
    </Modal>
  );
}
