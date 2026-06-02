import type { NextConfig } from "next";

const ONE_YEAR = 60 * 60 * 24 * 365;

const nextConfig: NextConfig = {
  // Optimisation : compression Brotli/gzip automatique des assets servis
  // par Vercel — déjà actif par défaut, mais on l'explicite.
  compress: true,

  // Headers HTTP de mise en cache pour les ressources statiques.
  // Vercel Edge sert avec ces headers, donc le navigateur (et tout CDN
  // intermédiaire) garde l'image au moins 1 an avant de redemander.
  // → -797 Ko économisés à chaque visite répétée (cf. audit PageSpeed).
  async headers() {
    return [
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
