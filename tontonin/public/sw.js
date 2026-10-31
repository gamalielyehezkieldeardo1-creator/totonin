/* Tontonin service worker — app shell offline, API cache, dan video tersimpan offline (dengan dukungan Range) */
const VERSION = 'v1';
const SHELL = 'tontonin-shell-' + VERSION;
const API = 'tontonin-api-' + VERSION;
const IMG = 'tontonin-img-' + VERSION;
const KEEP = [SHELL, API, IMG, 'tontonin-offline']; // 'tontonin-offline' = video yang disimpan pengguna (jangan dihapus)
const PRECACHE = ['/', '/style.css', '/app.js', '/placeholder.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const NO_CACHE_API = [/^\/api\/live/, /^\/api\/ads\/pick/];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

function networkFirst(req, cacheName, timeoutMs) {
  return (async () => {
    const cache = await caches.open(cacheName);
    try {
      const net = fetch(req);
      const res = await (timeoutMs ? Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]) : net);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req);
      if (hit) return hit;
      throw err;
    }
  })();
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

// Layani permintaan Range dari file yang tersimpan (wajib agar <video> bisa seek)
async function fromStored(req, hit) {
  const range = req.headers.get('range');
  if (!range) return hit;
  const blob = await hit.blob(), size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return hit;
  let start, end;
  if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  else { start = m[1] ? parseInt(m[1], 10) : 0; end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1; }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

async function handleMedia(req) {
  const url = new URL(req.url);
  const hit = await caches.match(url.pathname, { ignoreSearch: true });
  if (hit) return fromStored(req, hit);
  // thumbnail: cache-first (runtime) supaya beranda tetap bergambar saat offline
  if (/\.(jpe?g|png|webp|gif|svg)$/i.test(url.pathname) && !req.headers.get('range')) {
    const cache = await caches.open(IMG);
    const c = await cache.match(req);
    if (c) return c;
    const res = await fetch(req);
    if (res.ok) { cache.put(req, res.clone()); trim(IMG, 300); }
    return res;
  }
  return fetch(req); // video yang tidak disimpan: langsung dari jaringan
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname === '/ws') return;

  if (url.pathname.startsWith('/media/')) { e.respondWith(handleMedia(req)); return; }

  if (url.pathname.startsWith('/api/')) {
    if (NO_CACHE_API.some(r => r.test(url.pathname))) return; // selalu jaringan
    e.respondWith(networkFirst(req, API, 5000));
    return;
  }

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(new Request('/'), SHELL, 4000).catch(() => caches.match('/')));
    return;
  }

  e.respondWith(staleWhileRevalidate(req));
});
