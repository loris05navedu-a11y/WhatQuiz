// Service worker WhatQuiz : l'interface reste disponible même avec un réseau instable.
// Les données (API, temps réel, images envoyées) ne sont jamais mises en cache : elles viennent toujours du serveur.
const CACHE = 'whatquiz-v2';
// Le site peut être publié dans un sous-dossier (GitHub Pages) : tout est relatif à l'emplacement de ce fichier.
const BASE = new URL('./', self.location).pathname;
const SHELL = ['', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'theme-init.js'].map((path) => BASE + path);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const path = url.pathname.slice(BASE.length - 1);
  if (path.startsWith('/api/') || path.startsWith('/socket.io/') || path.startsWith('/uploads/')) return;

  // Navigation : réseau d'abord (version à jour), page en cache si hors ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(BASE, copy));
          return response;
        })
        .catch(() => caches.match(BASE)),
    );
    return;
  }

  // Fichiers statiques (noms uniques par version) : cache d'abord.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && (path.startsWith('/assets/') || path.startsWith('/icons/'))) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
