/* ==========================================================================
 * 文件：sw.js
 * 作用：离线缓存（Service Worker）—— 「添加到主屏幕」后像 App 一样打开，断网也能玩。
 * 策略：网络优先，拿到新文件就更新缓存；断网时用缓存。所以部署新版本后不会卡在旧版。
 *       /api/ 开头的请求（云存档）不缓存。
 * ========================================================================== */
var CACHE = 'bt-cache-v8g';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.indexOf('/api/') === 0) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req, { ignoreSearch: false }).then(function (r) { return r || caches.match(req, { ignoreSearch: true }); }); }));
});
