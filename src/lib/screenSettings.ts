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
