/* =========================================================================
   ReproBench — service worker (application installable)
   Réseau d'abord : on prend toujours la dernière version du site ; la copie
   en cache ne sert que si le réseau ne répond pas (Wi-Fi de l'atelier coupé),
   pour que l'application s'ouvre quand même. Les données (Supabase) ne sont
   jamais mises en cache ici.
   ========================================================================= */
const CACHE = 'reprobench-v11';
const SHELL = ['/', '/index.html', '/style.css', '/theme.js', '/script.js', '/saisie.js', '/icons.js', '/fiche.js', '/semaine.js', '/pilotage.js', '/motdepasse.js',
               '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if(req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return; // données et API : jamais en cache
  e.respondWith(
    fetch(req).then(res => {
      if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});
