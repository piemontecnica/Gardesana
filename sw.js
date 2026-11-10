/* Service worker: app shell + cache delle tile per uso in campo */
const SHELL = 'gard-shell-v1', TILES = 'gard-tiles-v1';
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png',
  'data/fogli.geojson', 'data/pozzetti.geojson', 'data/chiusure.geojson', 'data/impianti.geojson', 'data/tub_esistenti.geojson',
  'data/tub_ghisa.geojson', 'data/tub_pead.geojson', 'data/tub_prfv.geojson', 'data/viab_alt.geojson',
  'lib/leaflet.css', 'lib/leaflet.js',
  'lib/jszip.min.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, TILES].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const isTile = u => /\/tiles\/.+\.webp$/.test(u.pathname) || /arcgisonline\.com|tile\.openstreetmap\.org/.test(u.hostname);
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (isTile(u)) {
    // cache-first per le tile
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(e.request, { ignoreSearch: true }) || await c.match(u.pathname.replace(/^.*?\/tiles\//, 'tiles/'));
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // app shell e dati: rete prima (per avere aggiornamenti), cache come riserva
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const cl = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cl)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
