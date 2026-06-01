import type { Metadata } from 'next';
import { Nunito, Sacramento } from 'next/font/google';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { DebugConsole } from '@/components/debug/DebugConsole';
import { IdeasFloatingButtonGate } from '@/components/ideas/IdeasFloatingButtonGate';
import { getCurrentUser } from '@/lib/current-user';
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="fr" className={`${nunito.variable} ${sacramento.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ServiceWorkerRegister />
        <DebugConsole />
        {children}
        <IdeasFloatingButtonGate isAuthenticated={user.isAuthenticated} />
      </body>
    </html>
  );
}
