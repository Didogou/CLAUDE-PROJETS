import type { Metadata } from 'next';
import { Nunito, Sacramento } from 'next/font/google';
import { SpeedInsights } from '@vercel/speed-insights/next';
import NextTopLoader from 'nextjs-toploader';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { DebugConsole } from '@/components/debug/DebugConsole';
import { SubscriberFloatingTools } from '@/components/nutrition/SubscriberFloatingTools';
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

export const metadata: Metadata = {
  title: 'Karine Diététique',
  description: 'Prenons soin de vous — menus, recettes, conseils et astuces.',
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
        <SpeedInsights />
      </body>
    </html>
  );
}
