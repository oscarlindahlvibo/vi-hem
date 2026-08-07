export type ScreenView = 'short-stay' | 'work-orders' | 'presentation' | 'laundry' | 'meeting';
export type MeetingScreenPart = 'full' | 'part-1' | 'part-2';

export type PresentationSettings = {
  weatherLocation: string;
  showNews: boolean;
  showWorkOrders: boolean;
  showClockedIn: boolean;
  showMeetings: boolean;
  showTickerWeather: boolean;
  showTickerCheckIns: boolean;
  showTickerCheckOuts: boolean;
  showTickerClockedIn: boolean;
  showTickerUpdated: boolean;
  customTickerText?: string;
  customTickerItems: string[];
};

export type ScreenConfig = {
  screenKey: string;
  name: string;
  screenView: ScreenView;
  presentationSettings: PresentationSettings;
  laundryRoomId?: string;
  meetingId?: string;
  meetingPart?: MeetingScreenPart;
};

export const SCREEN_VIEW_STORAGE_KEY = 'vihem.screen.view';
export const PRESENTATION_SETTINGS_STORAGE_KEY = 'vihem.screen.presentationSettings';
export const SCREEN_KEY_STORAGE_KEY = 'vihem.screen.key';
export const DEFAULT_SCREEN_KEY = 'default';
export const ORGANISATION_SCREEN_SETTINGS_KEY = 'screen_settings';

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  weatherLocation: 'Värnamo',
  showNews: true,
  showWorkOrders: true,
  showClockedIn: true,
  showMeetings: true,
  showTickerWeather: true,
  showTickerCheckIns: true,
  showTickerCheckOuts: true,
  showTickerClockedIn: true,
  showTickerUpdated: true,
  customTickerText: '',
  customTickerItems: [],
};

export function isScreenView(value: unknown): value is ScreenView {
  return value === 'work-orders' || value === 'short-stay' || value === 'presentation' || value === 'laundry' || value === 'meeting';
}

export function isMeetingScreenPart(value: unknown): value is MeetingScreenPart {
  return value === 'full' || value === 'part-1' || value === 'part-2';
}

export function normalizePresentationSettings(input: unknown): PresentationSettings {
  const stored = input && typeof input === 'object' ? input as Partial<PresentationSettings> : {};
  const customTickerItems = Array.isArray(stored.customTickerItems)
    ? stored.customTickerItems.map(String)
    : stored.customTickerText
      ? [String(stored.customTickerText)]
      : [];

  return {
    ...DEFAULT_PRESENTATION_SETTINGS,
    ...stored,
    customTickerText: stored.customTickerText ? String(stored.customTickerText) : '',
    customTickerItems,
  };
}

export function defaultScreenConfig(index = 1): ScreenConfig {
  return {
    screenKey: index === 1 ? DEFAULT_SCREEN_KEY : `screen-${index}`,
    name: `Skärm ${index}`,
    screenView: index === 1 ? 'short-stay' : 'presentation',
    presentationSettings: DEFAULT_PRESENTATION_SETTINGS,
    laundryRoomId: '',
    meetingId: '',
    meetingPart: 'full',
  };
}

export function normalizeScreenConfig(input: unknown, fallbackIndex = 1): ScreenConfig {
  const stored = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const fallback = defaultScreenConfig(fallbackIndex);
  const storedPresentationSettings = stored.presentation_settings as Record<string, unknown> | undefined;
  const storedPresentationSettingsCamel = stored.presentationSettings as Record<string, unknown> | undefined;
  const key = typeof stored.screen_key === 'string'
    ? stored.screen_key
    : typeof stored.screenKey === 'string'
      ? stored.screenKey
      : fallback.screenKey;
  const name = typeof stored.name === 'string'
    ? stored.name
    : typeof stored.display_name === 'string'
      ? stored.display_name
      : typeof stored.displayName === 'string'
        ? stored.displayName
        : typeof storedPresentationSettings?.screen_name === 'string'
          ? String(storedPresentationSettings.screen_name)
          : typeof storedPresentationSettingsCamel?.screenName === 'string'
            ? String(storedPresentationSettingsCamel.screenName)
            : fallback.name;
  const view = isScreenView(stored.screen_view)
    ? stored.screen_view
    : isScreenView(stored.screenView)
      ? stored.screenView
      : fallback.screenView;

  return {
    screenKey: key,
    name,
    screenView: view,
    presentationSettings: normalizePresentationSettings(stored.presentation_settings || stored.presentationSettings),
    laundryRoomId: typeof stored.laundry_room_id === 'string'
      ? stored.laundry_room_id
      : typeof stored.laundryRoomId === 'string'
        ? stored.laundryRoomId
        : typeof storedPresentationSettings?.laundry_room_id === 'string'
          ? String(storedPresentationSettings.laundry_room_id)
          : typeof storedPresentationSettingsCamel?.laundryRoomId === 'string'
            ? String(storedPresentationSettingsCamel.laundryRoomId)
            : '',
    meetingId: typeof stored.meeting_id === 'string'
      ? stored.meeting_id
      : typeof stored.meetingId === 'string'
        ? stored.meetingId
        : typeof storedPresentationSettings?.meeting_id === 'string'
          ? String(storedPresentationSettings.meeting_id)
          : typeof storedPresentationSettingsCamel?.meetingId === 'string'
            ? String(storedPresentationSettingsCamel.meetingId)
            : '',
    meetingPart: isMeetingScreenPart(stored.meeting_part)
      ? stored.meeting_part
      : isMeetingScreenPart(stored.meetingPart)
        ? stored.meetingPart
        : isMeetingScreenPart(storedPresentationSettings?.meeting_part)
          ? storedPresentationSettings.meeting_part
          : isMeetingScreenPart(storedPresentationSettingsCamel?.meetingPart)
            ? storedPresentationSettingsCamel.meetingPart
            : 'full',
  };
}

export function isMissingScreenSettingsTable(error: unknown) {
  const message = String((error as { message?: string; code?: string } | null)?.message || '');
  const code = String((error as { code?: string } | null)?.code || '');
  return code === 'PGRST205' || (
    message.includes('vihem_screen_settings') &&
    (message.includes('schema cache') || message.includes('Could not find the table'))
  );
}

export function isScreenSettingsTableUnsupported(error: unknown) {
  const message = String((error as { message?: string; code?: string } | null)?.message || '');
  return isMissingScreenSettingsTable(error) || (
    message.includes('vihem_screen_settings_screen_view_check') ||
    message.includes('screen_view_check') ||
    (message.includes('violates check constraint') && message.includes('screen'))
  );
}

export function mergeScreenConfigs(primary: ScreenConfig[], secondary: ScreenConfig[]) {
  const byKey = new Map<string, ScreenConfig>();
  secondary.forEach(screen => byKey.set(screen.screenKey, screen));
  primary.forEach(screen => byKey.set(screen.screenKey, screen));
  return Array.from(byKey.values());
}

export function readOrganisationScreenConfigs(settings: unknown): ScreenConfig[] {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const raw = root[ORGANISATION_SCREEN_SETTINGS_KEY] || root.screenSettings;
  const stored = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawScreens = stored.screens || stored.screen_configs || stored.screenConfigs;

  if (Array.isArray(rawScreens)) {
    const screens = rawScreens.map((item, index) => normalizeScreenConfig(item, index + 1));
    if (screens.length > 0) return screens;
  }

  if (stored.screen_view || stored.screenView || stored.presentation_settings || stored.presentationSettings) {
    return [normalizeScreenConfig({
      screen_key: DEFAULT_SCREEN_KEY,
      name: 'Skärm 1',
      screen_view: stored.screen_view || stored.screenView,
      presentation_settings: stored.presentation_settings || stored.presentationSettings,
    }, 1)];
  }

  return [];
}

export function readOrganisationScreenSettings(settings: unknown, screenKey = DEFAULT_SCREEN_KEY): {
  screenView?: ScreenView;
  presentationSettings?: PresentationSettings;
  screenName?: string;
  screens: ScreenConfig[];
} {
  const screens = readOrganisationScreenConfigs(settings);
  const selected = screens.find(screen => screen.screenKey === screenKey) || screens[0];

  return {
    screenView: selected?.screenView,
    presentationSettings: selected?.presentationSettings,
    screenName: selected?.name,
    screens,
  };
}

export function buildOrganisationScreenSettings(
  existingSettings: unknown,
  screensOrView: ScreenConfig[] | ScreenView,
  presentationSettings?: PresentationSettings
): Record<string, unknown> {
  const root = existingSettings && typeof existingSettings === 'object'
    ? { ...existingSettings as Record<string, unknown> }
    : {};
  const screens = Array.isArray(screensOrView)
    ? screensOrView
    : [{
      ...defaultScreenConfig(1),
      screenView: screensOrView,
      presentationSettings: presentationSettings || DEFAULT_PRESENTATION_SETTINGS,
    }];

  root[ORGANISATION_SCREEN_SETTINGS_KEY] = {
    screens: screens.map(screen => ({
      screen_key: screen.screenKey,
      name: screen.name,
      screen_view: screen.screenView,
      laundry_room_id: screen.laundryRoomId || '',
      meeting_id: screen.meetingId || '',
      meeting_part: screen.meetingPart || 'full',
      presentation_settings: {
        ...screen.presentationSettings,
        laundry_room_id: screen.laundryRoomId || '',
        meeting_id: screen.meetingId || '',
        meeting_part: screen.meetingPart || 'full',
      },
    })),
  };

  return root;
}

export function readStoredScreenKey() {
  return localStorage.getItem(SCREEN_KEY_STORAGE_KEY) || DEFAULT_SCREEN_KEY;
}

export function readStoredScreenView(): ScreenView {
  const urlView = new URLSearchParams(window.location.search).get('view');
  if (isScreenView(urlView)) return urlView;
  const storedView = localStorage.getItem(SCREEN_VIEW_STORAGE_KEY);
  return isScreenView(storedView) ? storedView : 'short-stay';
}

export function readStoredPresentationSettings(): PresentationSettings {
  try {
    return normalizePresentationSettings(JSON.parse(localStorage.getItem(PRESENTATION_SETTINGS_STORAGE_KEY) || '{}'));
  } catch {
    return DEFAULT_PRESENTATION_SETTINGS;
  }
}

export function screenViewLabel(view: ScreenView) {
  if (view === 'short-stay') return 'Korttidskalender';
  if (view === 'work-orders') return 'Arbetsordrar';
  if (view === 'laundry') return 'Tvättstuga';
  if (view === 'meeting') return 'Mötesvy';
  return 'Presentation';
}
