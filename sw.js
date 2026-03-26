const CACHE = 'republique-v1';
self.addEventListener('install', function(e) {
  self.skipWaiting();
});
self.addEventListener('activate', function(e) {
  e.waitUntil(clients.claim());
});
