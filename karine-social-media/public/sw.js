// Service worker minimal — gère la cible de partage (PWA share_target)
const SHARE_PATH = '/admin/recettes/share';
const SHARE_CACHE = 'karine-share-target';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Intercepte uniquement le POST sur la route de partage déclarée dans le manifest
  if (event.request.method === 'POST' && url.pathname === SHARE_PATH) {
    event.respondWith(handleShare(event.request));
  }
});

async function handleShare(request) {
  try {
    const formData = await request.formData();
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const files = formData.getAll('images').filter((f) => f && f.size > 0);

    const cache = await caches.open(SHARE_CACHE);
    // On purge l'ancien partage avant d'en stocker un nouveau
    for (const key of await cache.keys()) await cache.delete(key);

    await cache.put(
      '/__share_meta',
      new Response(JSON.stringify({ title, text, count: files.length }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      await cache.put(
        `/__share_file_${i}`,
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'image/png',
            'X-File-Name': encodeURIComponent(file.name || `shared-${i}.png`),
          },
        }),
      );
    }

    return Response.redirect('/admin/recettes/new?shared=1', 303);
  } catch (e) {
    return new Response('Erreur de partage', { status: 500 });
  }
}
