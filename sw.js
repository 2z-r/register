// レジ用 Service Worker
// ・初回オンライン時にポータル・レジ本体・アイコンを端末へ保存（プリキャッシュ）
// ・以降は保存済みのファイルを先に表示し、裏で最新版を取得（次回起動から反映）
// ・?store=a など URL の「?」以降は無視して同じ index.html を返す
// ★ HTML・アイコンなどを更新したら、下の VERSION を書き換えてください（例: v3）
const VERSION = 'v16';
const CACHE = 'register-' + VERSION;

const SCOPE = self.registration.scope;               // 例: https://example.com/app/
const SCOPE_PATH = new URL(SCOPE).pathname;
const INDEX = new URL('index.html', SCOPE).href;
const PORTAL = new URL('portal.html', SCOPE).href;
const ASSETS = [
  'index.html', 'portal.html',
  'manifest.json', 'manifest-a.json', 'manifest-b.json', 'manifest-portal.json',
  'icon-192.png', 'icon-512.png',
  'icon-a-192.png', 'icon-a-512.png',
  'icon-b-192.png', 'icon-b-512.png',
  'icon-portal-192.png', 'icon-portal-512.png'
];

// 保存用のキー：URLの「?」以降を除き、フォルダ直下は index.html、拡張子なし（/portal など）は .html を補う
function keyFor(url) {
  const u = new URL(url);
  let p = u.pathname;
  if (p === SCOPE_PATH) return INDEX;
  const last = p.split('/').pop();
  if (last && !last.includes('.')) p += '.html';
  return u.origin + p;
}

// ホスティング側のリダイレクト（/portal.html → /portal 等）を経由した応答は、そのままだと画面表示に使えないので作り直す
function clean(res) {
  if (res && res.redirected) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }
  return res;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // スプレッドシート送信(POST)などには触れない
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 外部サイトへの通信には触れない

  const isNav = req.mode === 'navigate';
  const key = keyFor(req.url);

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });

    const update = fetch(key, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) cache.put(key, clean(res.clone()));
      return res;
    });

    if (cached) {                                         // 保存済みを即表示、裏で更新
      event.waitUntil(update.catch(() => {}));
      return clean(cached);
    }
    try {
      return await update;
    } catch (err) {                                       // 初回かつオフラインなど
      if (isNav) {
        const fallback = await cache.match(PORTAL, { ignoreSearch: true });
        if (fallback) return clean(fallback);
      }
      return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
