import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'se.vihem.app',
  appName: 'VI-HEM',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  ios: {
    // 'automatic' makes WKWebView's own scroll view add its own top/bottom
    // safe-area padding (notch, home indicator) on top of the app's own
    // env(safe-area-inset-*) CSS padding on the header/bottom nav -- a
    // double inset. That stacking became visible once #root (not body)
    // became the scroll container: reported as both bars growing much
    // taller than before. The app already handles safe areas itself via
    // CSS, so the native scroll view shouldn't add its own on top.
    contentInset: 'never',
  },
  plugins: {
    // Without this, PushNotificationsHandler.willPresent (see
    // @capacitor/push-notifications' iOS source) returns no presentation
    // options for a push that arrives while the app is foregrounded --
    // no banner, sound, or badge, only the silent 'pushNotificationReceived'
    // JS event. This makes foreground pushes visible too.
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
