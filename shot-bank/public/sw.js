// 目的はオフライン起動だけ。画像は IndexedDB にあるので、ここでは扱わない。
const CACHE = 'shot-bank-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return

  // HTML はネットワーク優先。そうしないと新しいデプロイのアセット名を拾えない。
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html').then((r) => r ?? Response.error())),
    )
    return
  }

  // それ以外はキャッシュ優先。Vite のアセット名は内容ハッシュ付きなので古いものを掴まない。
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ??
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
