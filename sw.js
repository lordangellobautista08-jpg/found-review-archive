/* CE Review service worker.
   - The page (index.html): always loaded from the network first, so every deploy is picked up. The saved copy is only used offline.
   - Versioned libraries and fonts: saved copy first (their URLs never change).
   - Other files on this site (icons, manifest): shown from the saved copy right away and refreshed in the background.
   You do NOT need to edit this file when you update index.html. */
const CACHE_NAME = 'ce-review-v2';
const SCOPE = self.registration.scope;
const SHELL = new URL('./', SCOPE).href;
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0',
  'https://fonts.googleapis.com/css2?family=Oswald:wght@600;700&family=Righteous&display=swap'
];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    /* one failed file must not break the install */
    await Promise.allSettled([cache.add(new Request(SHELL, { cache: 'reload' })), ...LIBS.map((u) => cache.add(u))]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE_NAME) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req.url, { cache: 'no-cache' }); /* no-cache = always ask the server if the page changed */
    if (res.ok) {
      cache.put(req.url, res.clone());
      cache.put(SHELL, res.clone()); /* offline fallback: the app is a single page */
      return res;
    }
  } catch (e) { /* offline */ }
  return (await cache.match(req.url)) || (await cache.match(SHELL)) || new Response('You are offline and the app is not saved yet.', { status: 503 });
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await fresh) || new Response('', { status: 504 });
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* Supabase (data + file storage) is never cached; ?upd=1 is the page's own "is there a new version" check */
  if (url.hostname.endsWith('supabase.co') || url.searchParams.has('upd')) return;
  if (req.mode === 'navigate') { event.respondWith(networkFirst(req)); return; }
  if (url.origin === self.location.origin) { event.respondWith(staleWhileRevalidate(req)); return; }
  if (CDN.test(req.url)) event.respondWith(cacheFirst(req));
});
