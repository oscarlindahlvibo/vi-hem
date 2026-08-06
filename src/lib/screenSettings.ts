export type ScreenView = 'short-stay' | 'work-orders' | 'presentation';

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

export const SCREEN_VIEW_STORAGE_KEY = 'vihem.screen.view';
export const PRESENTATION_SETTINGS_STORAGE_KEY = 'vihem.screen.presentationSettings';
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
  return value === 'work-orders' || value === 'short-stay' || value === 'presentation';
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

export function isMissingScreenSettingsTable(error: unknown) {
  const message = String((error as { message?: string; code?: string } | null)?.message || '');
  const code = String((error as { code?: string } | null)?.code || '');
  return code === 'PGRST205' || (
    message.includes('vihem_screen_settings') &&
    (message.includes('schema cache') || message.includes('Could not find the table'))
  );
}

export function readOrganisationScreenSettings(settings: unknown): {
  screenView?: ScreenView;
  presentationSettings?: PresentationSettings;
} {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const raw = root[ORGANISATION_SCREEN_SETTINGS_KEY] || root.screenSettings;
  const stored = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const screenView = isScreenView(stored.screen_view) ? stored.screen_view : isScreenView(stored.screenView) ? stored.screenView : undefined;
  const presentationSettings = stored.presentation_settings || stored.presentationSettings
    ? normalizePresentationSettings(stored.presentation_settings || stored.presentationSettings)
    : undefined;

  return { screenView, presentationSettings };
}

export function buildOrganisationScreenSettings(
  existingSettings: unknown,
  screenView: ScreenView,
  presentationSettings: PresentationSettings
): Record<string, unknown> {
  const root = existingSettings && typeof existingSettings === 'object'
    ? { ...existingSettings as Record<string, unknown> }
    : {};

  root[ORGANISATION_SCREEN_SETTINGS_KEY] = {
    screen_view: screenView,
    presentation_settings: presentationSettings,
  };

  return root;
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
  return 'Presentation';
}
