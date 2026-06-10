import type { NextConfig } from "next";

const ONE_YEAR = 60 * 60 * 24 * 365;

const nextConfig: NextConfig = {
  // Optimisation : compression Brotli/gzip automatique des assets servis
  // par Vercel — déjà actif par défaut, mais on l'explicite.
  compress: true,

  // Securite : pas de source maps en prod cote client. Defaut Next.js,
  // mais explicite ici pour eviter qu'un dev active par megarde et
  // expose le code source frontend complet (commentaires, noms originaux,
  // patterns auth, TODOs...) via les .map files servis publiquement.
  productionBrowserSourceMaps: false,

  // Strip console.log/error/warn/debug en prod cote client. console.error
  // garde un canal pour Sentry / logs critiques. Empeche les fuites
  // d'info technique (structures DB, IDs, stack traces) via les logs
  // navigateur quand un utilisateur ouvre DevTools.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error'] }
      : false,
  },

  // Headers HTTP de mise en cache pour les ressources statiques.
  // Vercel Edge sert avec ces headers, donc le navigateur (et tout CDN
  // intermédiaire) garde l'image au moins 1 an avant de redemander.
  // → -797 Ko économisés à chaque visite répétée (cf. audit PageSpeed).
  async headers() {
    // Headers de securite appliques sur TOUTE l'app (path source: '/:path*').
    // Comme `headers()` doit retourner un array, on construit tout ici.
    const SECURITY_HEADERS = [
      // Empeche le clickjacking (pas d'iframe embed du site).
      { key: 'X-Frame-Options', value: 'DENY' },
      // MIME sniffing OFF (anti type-confusion).
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      // Referrer minimal cross-origin (RGPD-friendly).
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // Coupe les APIs sensibles non utilisees par l'app.
      {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
      },
      // HSTS (Vercel met deja HTTPS only, ceci verrouille cote browser).
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      // CSP — strict mais permissive sur ce qui est reellement utilise :
      //   - script-src 'self' + inline pour Next/RSC + Stripe Checkout + Vercel Analytics
      //   - connect-src Supabase + Stripe + Mistral + Anthropic + Resend + Vercel
      //   - img-src Supabase Storage + Stripe + data:
      //   - frame-src Stripe Checkout (paiements)
      //   - object-src 'none' (anti Flash/PDF embed)
      //   - frame-ancestors 'none' (idem X-Frame-Options pour browsers recents)
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // 'unsafe-eval' nécessaire EN DEV uniquement : React dev mode
          // utilise eval() pour reconstruire les callstacks (debug,
          // erreurs lisibles). En prod, React n'utilise jamais eval()
          // donc on le retire (surface XSS réduite).
          process.env.NODE_ENV === 'development'
            ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.stripe.com https://va.vercel-scripts.com"
            : "script-src 'self' 'unsafe-inline' https://*.stripe.com https://va.vercel-scripts.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https://*.supabase.co https://*.stripe.com",
          "font-src 'self' data:",
          "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://api.mistral.ai https://api.anthropic.com https://api.resend.com https://vitals.vercel-insights.com",
          "frame-src https://*.stripe.com https://hooks.stripe.com",
          "frame-ancestors 'none'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self' https://*.stripe.com",
        ].join('; '),
      },
    ];

    return [
      // Securite : applique partout (sauf endpoints d'embed eventuel).
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // Toutes les images livrées dans public/images/
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: `public, max-age=${ONE_YEAR}, immutable`,
          },
        ],
      },
      {
        // Service worker généré (sw.js) : pas de cache long (sinon les
        // updates de l'app ne sont jamais distribuées).
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },

  // Optimisation images automatique : Next.js convertit en AVIF / WebP
  // selon ce que le navigateur supporte, et génère plusieurs tailles
  // responsive. Actif par défaut pour les composants <Image>.
  images: {
    formats: ['image/avif', 'image/webp'],
    // Domaines Supabase Storage autorisés pour next/image
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
