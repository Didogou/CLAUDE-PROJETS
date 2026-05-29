import type { Metadata } from 'next';
import { Nunito, Sacramento } from 'next/font/google';
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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
