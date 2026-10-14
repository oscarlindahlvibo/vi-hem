import type { PresentationSettings } from './screenSettings';

// TV browsers can report 960×540 CSS pixels despite a full-HD panel.
// Keep landscape displays in blocks; only phones/portrait previews stack.
export function screenUsesStackedLayout(width: number, height: number) {
  return width < 640 || width < height;
}

export function presentationLayout(settings: PresentationSettings, width: number, height: number) {
  const narrow = screenUsesStackedLayout(width, height);
  const weights = [
    settings.showNews ? 0.66 : 0,
    settings.showClockedIn ? 1.15 : 0,
    settings.showMeetings ? 0.9 : 0,
  ].filter(weight => weight > 0);
  return {
    narrow,
    columns: !narrow && settings.showWorkOrders && weights.length > 0
      ? 'minmax(0, 1.35fr) minmax(0, 0.95fr)' : 'minmax(0, 1fr)',
    // Explicit zero minimums prevent long content from resizing the board.
    panelRows: narrow ? undefined : weights.map(weight => `minmax(0, ${weight}fr)`).join(' ') || 'minmax(0, 1fr)',
  };
}
