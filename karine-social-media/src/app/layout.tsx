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
