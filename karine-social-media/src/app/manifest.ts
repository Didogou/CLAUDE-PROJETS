import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Karine Diététique',
    short_name: 'Karine',
    description: 'Vos menus, recettes, conseils et astuces — par votre diététicienne.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fdf2f3',
    theme_color: '#e2788d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Raccourcis (long-press de l'icône) — pratique pour Karine (admin)
    shortcuts: [
      {
        name: 'Tableau de bord',
        short_name: 'Dashboard',
        description: 'Vue d’ensemble de votre activité',
        url: '/admin',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Nouvelle recette',
        short_name: 'Nouvelle recette',
        description: 'Créer une recette directement',
        url: '/admin/recettes/new',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    // Cible de partage : depuis ChatGPT (ou n'importe quelle app) → "Partager" → Karine
    share_target: {
      action: '/admin/recettes/share',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [
          {
            name: 'images',
            accept: ['image/png', 'image/jpeg', 'image/webp'],
          },
        ],
      },
    },
  };
}
