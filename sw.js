const VERSION = 'v-20261005-0837';
// sw.js —— 离线：第一次联网打开时把整个 app 存进手机，之后路上断网也能打开。
//
// ★ 第一行必须正好是「const VERSION = '...';」：发布脚本用 sed 把它换成发布时刻。版本一变，手机就会装新的一份，
//   页面底下出「有新版本 · 点这里刷新」。
// ★ 下面的 FILES：网页/ 里每个 .html / .js / .css / .webmanifest / .png（sw.js 自己除外）都要在里面，每一项都要真的存在
//   （工具/发布前检查.py 会两边对）。那一段里只放文件名，别写注释、别写别的带单引号的东西 —— 检查是按单引号抠文件名的。
// ★ 取文件：先用手机里存的（快、断网也行），同时后台去取新的存起来；取不到就用存的，首页取不到就给存的首页。
const CACHE = 'zijia-' + VERSION;
const FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'calc.js',
  'plan.js',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-512.png',
];

self.addEventListener('install', event => {
  // cache: 'reload' = 绕过浏览器自己的缓存，拿服务器上的最新一份
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  // 只删自己以前的版本（zijia- 开头），别的不碰
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.indexOf('zijia-') === 0 && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 导航跳高德、打电话这些不归这里管
  const isPage = req.mode === 'navigate';
  event.respondWith(caches.open(CACHE).then(cache => {
    const key = isPage ? './' : req;
    return cache.match(key, { ignoreSearch: true }).then(hit => {
      const fresh = fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      });
      if (hit) {
        event.waitUntil(fresh.catch(() => null));   // 后台更新，失败不要紧（下次再取）
        return hit;
      }
      return fresh.catch(() => (isPage ? cache.match('index.html') : undefined)).then(res => res || Response.error());
    });
  }));
});
