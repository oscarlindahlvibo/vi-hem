// Retire the previous application worker on vi-hem.se without reloading open windows.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.registration.unregister()));
