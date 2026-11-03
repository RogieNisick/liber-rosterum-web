// Офлайн: оболочка приложения кешируется при установке. Данные BSData и ростеры лежат в IndexedDB.
// При выпуске новой версии меняйте VERSION (build.sh делает это сам).
const VERSION = 'lr-20261103123549';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/engine.js', 'js/glyphs.js', 'js/theme.js', 'js/store.js', 'js/zip.js', 'js/names.js', 'js/app.js', 'js/smart-worker.js',
  'fonts/Cinzel-700.ttf', 'fonts/Cinzel-900.ttf', 'fonts/CormorantSC-Bold.ttf', 'fonts/PT_Sans-Narrow-Web-Regular.ttf', 'fonts/PT_Sans-Narrow-Web-Bold.ttf',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'art/slot_armour.png', 'art/slot_command.png', 'art/slot_elites.png', 'art/slot_fast_attack.png', 'art/slot_heavy_assault.png',
  'art/slot_heavy_transport.png', 'art/slot_high_command.png', 'art/slot_lord_of_war.png', 'art/slot_recon.png', 'art/slot_retinue.png',
  'art/slot_support.png', 'art/slot_transport.png', 'art/slot_troops.png', 'art/slot_war_engine.png', 'art/slot_warlord.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // GitHub/BSData — напрямую
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit ||
    fetch(e.request).catch(() => e.request.mode === 'navigate' ? caches.match('index.html') : Response.error())));
});
