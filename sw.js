// Service worker simples: permite instalar como app. Os dados sempre vêm da internet.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* sem cache: tudo direto da rede */ });
