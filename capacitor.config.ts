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
    contentInset: 'automatic',
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
