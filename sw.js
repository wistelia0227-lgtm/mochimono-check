// オフラインでも開けるようにアプリ本体をキャッシュする。データ(IndexedDB)には触れない。
// ファイルを更新したら VERSION を上げる（古いキャッシュが捨てられる）。
const VERSION = 'mochimono-v0.5';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/util.js', 'js/db.js', 'js/master.js', 'js/model.js', 'js/app.js',
  'modules/stay.js', 'modules/residents.js', 'modules/search.js', 'modules/settings.js', 'modules/print.js', 'modules/pickfrom.js', 'modules/camera.js', 'modules/namepick.js', 'modules/lab.js', 'modules/devtools.js',
  'icons/icon-192.png', 'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  // devtools.js など任意のファイルが無くても失敗しないよう、1件ずつ入れる
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネット優先・だめならキャッシュ（更新がすぐ届き、圏外でも開ける）
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
