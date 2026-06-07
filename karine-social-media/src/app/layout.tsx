import type { Metadata, Viewport } from 'next';
import { Nunito, Sacramento } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import NextTopLoader from 'nextjs-toploader';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { DebugConsole } from '@/components/debug/DebugConsole';
import { SubscriberFloatingTools } from '@/components/nutrition/SubscriberFloatingTools';
import { ToastHost } from '@/components/ui/ToastHost';
import { PostAuthPatientRequestEffect } from '@/components/auth/PostAuthPatientRequestEffect';
import './globals.css';

const nunito = Nunito({
  variable: '--font-nunito',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
});

const sacramento = Sacramento({
  variable: '--font-sacramento',
  subsets: ['latin'],
  weight: '400',
});

// Re-deploy test post-GitHub-App-reinstall 2026-06-04.
export const metadata: Metadata = {
  title: 'Karine Diététique',
  description: 'Prenons soin de vous — menus, recettes, conseils et astuces.',
  // Icônes pour favoris navigateur ET "Ajouter à l'écran d'accueil".
  //
  // ⚠️ iOS (Safari ET Chrome iOS qui utilise WebKit) IGNORE le manifest
  // pour l'icône d'écran d'accueil — il ne lit QUE `<link rel=apple-touch-icon>`.
  // Sans cette ligne explicite, iOS prend un screenshot de la page comme
  // icône → l'utilisatrice qui "Ajoute à l'écran d'accueil" voit un truc
  // bizarre au lieu du logo Karine.
  //
  // Tous générés depuis assets-source/06_ICONES_ET_UI/Icon.png (1024×1024)
  // via sharp aux tailles standards Apple/Google. Cf. scripts/regen-icons.mjs.
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  },
};

// Sans <meta viewport>, Safari iOS rend l'app dans un canvas virtuel de
// 980px et la scale down. Conséquences observées : sheet Mes calories
// décalée à gauche, contenu minuscule, scroll horizontal parasite.
// viewport-fit=cover laisse le contenu déborder sous l'island/notch.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // PAS de maximumScale ni de userScalable=no : on laisse le pinch-to-zoom
  // (accessibilité WCAG — les utilisatrices presbytes / malvoyantes y
  // tiennent). Sans maximumScale fixe, iOS gère le scale au pinch et
  // remet à 1 quand on relâche.
  viewportFit: 'cover',
  themeColor: '#fdf2f3',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${nunito.variable} ${sacramento.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* Barre de progression au-dessus de tout : s'allume instantanement
            au clic sur un lien, donne le feedback visuel "ca travaille"
            pendant la preparation cote serveur (sinon l'utilisatrice a
            l'impression que rien ne se passe et reclique). */}
        <NextTopLoader
          color="#e2788d"
          height={3}
          showSpinner={false}
          shadow="0 0 8px #e2788d, 0 0 4px #e2788d"
          easing="ease"
          speed={250}
        />
        <ServiceWorkerRegister />
        <DebugConsole />
        {children}
        <SubscriberFloatingTools />
        <ToastHost />
        {/* Finalise une demande "patiente de Karine" stashée juste avant un
            round-trip OAuth (cf. /signup → cocher la case + Continuer avec
            Google). Aucun rendu visible — toast au retour si applicable. */}
        <PostAuthPatientRequestEffect />
        <SpeedInsights />
      </body>
    </html>
  );
}
