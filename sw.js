/* ============================================================
   OVERLOAD — service worker
   Two jobs:
     1. Precache the app shell so the app opens with zero network.
     2. Fire the rest-timer notification while the screen is locked.
   Bump CACHE on every shell change — that is what triggers the update.
   ============================================================ */
/* The food database is deliberately NOT precached: it is not published with the
   app (IFCT terms), and lives in IndexedDB after a one-time file load. */
const CACHE = 'overload-shell-v10';

const SHELL = [
  './',
  './index.html',
  './core.js',
  './workout.js',
  './body.js',
  './nutrition.js',
  './manifest.webmanifest',
  './fonts/fonts.css',
  './fonts/BarlowCondensed-500.woff2',
  './fonts/BarlowCondensed-600.woff2',
  './fonts/BarlowCondensed-700.woff2',
  './fonts/Inter-400.woff2',
  './fonts/Inter-500.woff2',
  './fonts/Inter-600.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll is atomic: one 404 and nothing is cached. Fetch individually so a
    // single missing asset degrades instead of leaving the app with no shell.
    await Promise.all(SHELL.map(async url => {
      try { await c.add(new Request(url, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] precache miss', url, err); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

/* Offline has to be indistinguishable from online, but the app also has to be
   able to replace itself. Those pull in opposite directions, so they get
   different strategies:
     - the document: network-first on a short leash, cache the moment that
       fails. Cache-first here strands the app on an old build permanently.
     - everything else: serve from cache instantly, refresh in the background.
   Cross-origin requests are none of our business. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate' || req.destination === 'document') e.respondWith(networkFirst(req));
  else e.respondWith(staleWhileRevalidate(req));
});

function withTimeout(p, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('network timeout')), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // Offline, fetch rejects immediately, so this is not a 2.5s stall in
    // airplane mode — only on a network that is present but useless.
    const res = await withTimeout(fetch(req), 2500);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true })
             || await cache.match('./index.html')
             || await cache.match('./');
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) return hit;
  const res = await net;
  if (res) return res;
  throw new Error('offline and not cached: ' + req.url);
}

/* ---------- rest timer ----------
   Preferred path is a TimestampTrigger: the browser owns the schedule, so it
   fires even if this worker has been shut down. Where that is unavailable we
   hold the worker awake with an unresolved waitUntil, which browsers cap at a
   few minutes — long enough for a rest set, but not guaranteed. The page keeps
   its own in-page timer running either way, so nothing depends on this. */
let restTimer = null;

self.addEventListener('message', e => {
  const m = e.data || {};

  if (m.type === 'rest:schedule') {
    e.waitUntil(scheduleRest(m.at, m.tag || 'rest', m.body || ''));
  } else if (m.type === 'rest:cancel') {
    e.waitUntil(cancelRest(m.tag || 'rest'));
  } else if (m.type === 'skipWaiting') {
    self.skipWaiting();
  }
});

async function cancelRest(tag) {
  if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  for (const n of await self.registration.getNotifications({ tag, includeTriggered: true })) n.close();
}

async function scheduleRest(at, tag, body) {
  await cancelRest(tag);
  const delay = at - Date.now();
  if (delay <= 0) return fire(tag, body);

  const opts = {
    tag,
    body: body || 'Next set.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [200, 80, 200],
    renotify: true,
    requireInteraction: false,
    data: { kind: 'rest' }
  };

    if ('showTrigger' in Notification.prototype) {
    try {
      await self.registration.showNotification('Rest over', {
        ...opts,
        showTrigger: new TimestampTrigger(at)
      });
      return;
    } catch (err) { /* fall through to the keepalive path */ }
  }

  await new Promise(resolve => {
    restTimer = setTimeout(async () => {
      restTimer = null;
      await fire(tag, body);
      resolve();
    }, delay);
  });
}

async function tell(msg) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}

async function fire(tag, body) {
  // Don't interrupt if the app is already open and in front — the in-page
  // timer has it covered and a duplicate buzz is just noise.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.some(c => c.visibilityState === 'visible' && c.focused)) {
    await tell({ type: 'rest:elapsed', tag, notified: false });
    return;
  }
  await tell({ type: 'rest:elapsed', tag, notified: true });

  await self.registration.showNotification('Rest over', {
    tag,
    body: body || 'Next set.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [200, 80, 200],
    renotify: true,
    data: { kind: 'rest' }
  });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
