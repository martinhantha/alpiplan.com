/* Alpiplan service worker — Web Push, plus a fallback page when the server is unreachable. */

const OFFLINE_CACHE = "alpiplan-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 502 || response.status === 503 || response.status === 504) {
          return offlineResponse(response);
        }
        return response;
      })
      .catch(() => offlineResponse()),
  );
});

async function offlineResponse(fallback) {
  const cache = await caches.open(OFFLINE_CACHE);
  const cached = await cache.match(OFFLINE_URL);
  return cached || fallback || new Response("Wir sind gleich wieder da.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function targetUrl(data) {
  if (data && data.type === "appointment.briefing") return "/";
  if (data && data.appointmentId) return "/appointments";
  return "/";
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  const data = payload.data || {};
  // Safari revokes the subscription if a push does not show a notification, so always show one.
  event.waitUntil(
    self.registration.showNotification(payload.title || "Alpiplan", {
      body: payload.body || "",
      tag: payload.tag || undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { ...data, url: targetUrl(data) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) await existing.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
