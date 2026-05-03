import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    workerThreads: false,
    cpus: 1,
  },
  turbopack: {
    root: __dirname,
  },
  // Masque l'overlay dev Next.js (DevTools + build indicator) pour libérer
  // le coin bas-droit de l'ImageEditor. Status de build visible dans le terminal.
  // Pour le réactiver : remplacer par `{ position: 'bottom-left' }` (défaut Next 16).
  devIndicators: false,
};

export default nextConfig;
