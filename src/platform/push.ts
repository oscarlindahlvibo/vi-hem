import { Capacitor } from '@capacitor/core';
import { PushNotifications, type Token, type ActionPerformed } from '@capacitor/push-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { supabase } from '../lib/supabase';

let listenersRegistered = false;
let activeContext: { userId: string; organisationId: string } | null = null;

/**
 * Länkar från tryckta pushnotiser. App.tsx är inte monterad när en kallstartstryckning rapporteras, så länken köas tills någon lyssnar
 * och spelas upp för den första prenumeranten. Flera prenumeranter får varje länk; ingen ersätter en annan.
 */
export function createPushLinks() {
  const listeners = new Set<(link: string) => void>();
  let pending: string[] = [];
  return {
    emit(link: string | undefined) {
      if (!link) return;
      if (listeners.size === 0) { pending.push(link); return; }
      for (const l of [...listeners]) l(link);
    },
    subscribe(listener: (link: string) => void): () => void {
      listeners.add(listener);
      if (pending.length) { const queued = pending; pending = []; for (const link of queued) listener(link); }
      return () => { listeners.delete(listener); };
    },
  };
}

const pushLinks = createPushLinks();
export const addPushNavigationListener = pushLinks.subscribe;

export async function registerNativePush(userId: string, organisationId: string | null) {
  if (!Capacitor.isNativePlatform() || !organisationId) return;
  activeContext = { userId, organisationId };

  const permission = await PushNotifications.checkPermissions();
  const nextPermission = permission.receive === 'prompt'
    ? await PushNotifications.requestPermissions()
    : permission;
  if (nextPermission.receive !== 'granted') return;

  if (!listenersRegistered) {
    await PushNotifications.addListener('registration', async (token: Token) => {
      if (activeContext) await saveToken(activeContext.userId, activeContext.organisationId, token.value);
    });
    await PushNotifications.addListener('registrationError', error => {
      console.warn('Native push registration failed:', error);
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
      pushLinks.emit(action.notification?.data?.link);
    });
    listenersRegistered = true;
  }

  await PushNotifications.register();
}

async function saveToken(userId: string, organisationId: string, token: string) {
  const platform = Capacitor.getPlatform();
  const { error } = await supabase.from('vihem_push_tokens').upsert({
    user_id: userId,
    organisation_id: organisationId,
    platform,
    token,
    active: true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'platform,token' });
  if (error) console.warn('Could not save native push token:', error.message);
}

export async function unregisterNativePush(userId: string) {
  if (!Capacitor.isNativePlatform()) return;
  await supabase.from('vihem_push_tokens').update({ active: false }).eq('user_id', userId);
  if (activeContext?.userId === userId) activeContext = null;
}

/**
 * Keeps the home-screen app icon badge in sync with the in-app unread
 * count. iOS sets the badge from each push's `aps.badge` field, but never
 * clears it on its own -- opening the app and reading notifications there
 * doesn't touch the OS-level badge unless something explicitly tells it
 * to. Call this wherever the unread count is (re)computed.
 */
export async function syncNativeBadge(count: number) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Badge.set({ count });
  } catch (error) {
    console.warn('Could not sync native badge:', error);
  }
}
