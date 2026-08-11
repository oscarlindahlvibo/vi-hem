const configuredAppUrl = import.meta.env.VITE_PUBLIC_APP_URL?.trim().replace(/\/$/, '');

function publicAppUrl() {
  if (configuredAppUrl) return configuredAppUrl;

  if (typeof window !== 'undefined') {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    return isLocal ? window.location.origin : 'https://app.vi-hem.se';
  }

  return 'https://app.vi-hem.se';
}

export function passwordResetRedirectUrl() {
  return `${publicAppUrl()}/reset-password`;
}
