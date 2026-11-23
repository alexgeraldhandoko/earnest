/* Earnest service worker — network-first app shell. Live data (/api, /uploads)
   and video files always go straight to the network. Shell assets are fetched
   fresh on every load when online (cache is only an offline fallback), so a
   republished fix can never be masked by a stale cached UI. */
"use strict";
const VERSION = "earnest-shell-v36";
const SHELL = [
  "/", "/index.html", "/app.css", "/story.css", "/tokens.css", "/base.css", "/app.js", "/mvworld.js", "/mv3d.js", "/vendor/three.min.js", "/story.js",
  "/worlds/courtyard.jpg", "/worlds/courtyard.png", "/worlds/school.png", "/worlds/commute.jpg", "/worlds/commute.png", "/worlds/rooftop.jpg", "/worlds/office.png",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/") || url.pathname.startsWith("/videos/")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  /* network-first: always serve the latest published asset when online;
     fall back to the cached copy only when the network fails (offline). */
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});