/* Same-origin read cache only. No mutation interception, replay or health fallback. */
const DATA = "taesks-reads-v1";
const VERSION = "__TAESKS_BUILD__";
const ASSETS = `taesks-assets-${VERSION}`;
const SHELL = `taesks-shell-${VERSION}`;
const READS = new Set(["/api/local", "/api/graph", "/api/config", "/api/github", "/api/contact", "/api/notion/schema"]);
let readWrites = Promise.resolve();
function storeRead(cache, key, response) {
  const work = readWrites.then(async () => {
    await cache.put(key, response);
    const keys = await cache.keys();
    for (const oldest of keys.slice(0, Math.max(0, keys.length - 150))) await cache.delete(oldest);
  });
  readWrites = work.catch(() => {});
  return work;
}
async function pruneAssets(cache) {
  const keys = await cache.keys(); if (keys.length <= 512) return;
  const current = await (await caches.open(SHELL)).match("/");
  const html = current ? await current.text() : "";
  const pinned = new Set([...html.matchAll(/(?:src|href)="([^" ]+)"/g)].map(match => new URL(match[1], self.location.origin).href));
  let remaining = keys.length;
  for (const key of keys) { const pathname = new URL(key.url).pathname; if (remaining <= 512) break; if (!pinned.has(key.url) && !pathname.startsWith("/icons/") && pathname !== "/manifest.webmanifest") { await cache.delete(key); remaining--; } }
}
async function shell(response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
  const html = await response.clone().text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)="([^" ]+)"/g)].map(match => match[1]).filter(url => url.startsWith("/_next/static/")))];
  const assets = await caches.open(ASSETS);
  await Promise.all(urls.map(async url => { if (!await assets.match(url)) { const asset = await fetch(url); if (!asset.ok) throw new Error("Asset unavailable"); await assets.put(url, asset); } }));
  await (await caches.open(SHELL)).put("/", response.clone());
}
self.addEventListener("install", event => { event.waitUntil((async () => { await shell(await fetch("/", { cache: "no-store" })); await (await caches.open(ASSETS)).addAll(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/maskable-512.png"]); })()); });
// No skipWaiting: an updated worker activates after the old app windows close.
// Asset caches retain content-hashed files, so retained HTML always has its matching bundle.
self.addEventListener("activate", event => { event.waitUntil((async () => {
  const names = await caches.keys(); await Promise.all(names.filter(name => (name.startsWith("taesks-assets-") && name !== ASSETS) || (name.startsWith("taesks-shell-") && name !== SHELL)).map(name => caches.delete(name)));
  await self.clients.claim();
})()); });
self.addEventListener("fetch", event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith((async () => { try { const response = await fetch(request); event.waitUntil(shell(response).catch(() => {})); return response; } catch { return await (await caches.open(SHELL)).match("/") || Response.error(); } })()); return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith((async () => { const cache = await caches.open(ASSETS); const cached = await cache.match(request); if (cached) return cached; const response = await fetch(request); if (response.ok) event.waitUntil(cache.put(request, response.clone()).then(() => pruneAssets(cache))); return response; })()); return;
  }
  if (!READS.has(url.pathname)) return;
  // Force-refresh URLs share their ordinary read key, while different pages/filters remain distinct.
  url.searchParams.delete("refresh"); const key = url.href;
  event.respondWith((async () => {
    const cache = await caches.open(DATA);
    try {
      const response = await fetch(request);
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const headers = new Headers(response.headers); headers.set("X-Taesks-Cached-At", new Date().toISOString());
        const stored = new Response(await response.clone().arrayBuffer(), { status: response.status, headers });
        event.waitUntil(storeRead(cache, key, stored));
      }
      return response;
    } catch {
      const cached = await cache.match(key); if (!cached) return Response.error();
      const headers = new Headers(cached.headers); headers.set("X-Taesks-Offline", "1");
      return new Response(await cached.arrayBuffer(), { status: cached.status, headers });
    }
  })());
});
self.addEventListener("message", event => {
  if (event.data?.type === "push-capability") event.ports?.[0]?.postMessage({ pushVersion: 1 });
});
const REMINDER_COPY = /*__TAESKS_REMINDER_COPY__*/ { title: "TÆSKS / reminder", body: "A reminder is due. Open TÆSKS." };
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (payload?.type !== "reminder" || typeof payload.taskId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.taskId) || typeof payload.tag !== "string" || !/^taesks-[A-Za-z0-9_-]{43}$/.test(payload.tag) || typeof payload.reminderAt !== "string" || !Number.isFinite(Date.parse(payload.reminderAt))) return;
    await self.registration.showNotification(REMINDER_COPY.title, { body: REMINDER_COPY.body, tag: payload.tag, renotify: false, icon: "/icons/icon-192.png", data: { taskId: payload.taskId } });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const taskId = event.notification.data?.taskId;
  event.waitUntil((async () => { const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }); if (windows.length) { await windows[0].focus(); windows[0].postMessage({ type: "open-reminder", taskId }); } else await self.clients.openWindow(`/?reminder=${encodeURIComponent(taskId || "")}`); })());
});
