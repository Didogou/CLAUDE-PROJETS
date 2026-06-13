// Service worker minimal — gère :
//  1) la cible de partage (PWA share_target → /admin/recettes/share)
//  2) le cache du modèle vocal Vosk (~44 Mo, supabase répond no-cache donc
//     sans intervention le browser re-fetche à chaque session → on stocke
//     en Cache API, valable indéfiniment jusqu'à update manuel du path)
const SHARE_PATH = '/admin/recettes/share';
const SHARE_CACHE = 'karine-share-target';

// Cache du modèle Vosk. Version dans le nom : bump si on change de modèle
// pour invalider le vieux cache (et l'ancienne version disparaît au
// prochain activate via la purge ci-dessous).
const VOSK_CACHE = 'karine-vosk-v1';
const VOSK_MODEL_PATH_FRAGMENT = '/static-assets/vosk/';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge les vieilles versions de cache Vosk (ex: karine-vosk-v0
      // quand on passe à v1) pour ne pas garder 44 Mo de modèle obsolète
      // indéfiniment sur le device.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('karine-vosk-') && k !== VOSK_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Intercepte le modèle vocal Vosk — peu importe le domaine Supabase
  // (Karine peut migrer de projet). On match juste le path qui contient
  // /static-assets/vosk/ sur un domaine supabase.co.
  if (
    event.request.method === 'GET' &&
    url.hostname.endsWith('.supabase.co') &&
    url.pathname.includes(VOSK_MODEL_PATH_FRAGMENT)
  ) {
    event.respondWith(cacheFirstVoskModel(event.request));
    return;
  }

  // Intercepte uniquement le POST sur la route de partage déclarée dans le manifest
  if (event.request.method === 'POST' && url.pathname === SHARE_PATH) {
    event.respondWith(handleShare(event.request));
  }
});

// Cache-first pour le modèle Vosk : si on a une copie en Cache API, on
// la sert (0 réseau). Sinon on fetch + on met en cache. Le fichier est
// immutable (versionnage via le path), donc on n'a jamais besoin de
// revalider une fois en cache.
async function cacheFirstVoskModel(request) {
  const cache = await caches.open(VOSK_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const fresh = await fetch(request);
  // On ne cache que les réponses 200 OK (pas les 302, 403, etc.)
  if (fresh.ok) {
    // clone() requis : un Response body ne peut être lu qu'une fois,
    // on en garde un pour le cache et on renvoie l'autre au client.
    cache.put(request, fresh.clone()).catch((err) => {
      // Si le quota de cache est dépassé, le browser jette une erreur
      // QuotaExceededError. On n'a pas grand-chose à faire ici, mieux
      // vaut ne pas planter le fetch — la prochaine session re-tentera.
      console.warn('[sw] vosk cache put failed:', err?.message ?? err);
    });
  }
  return fresh;
}

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
