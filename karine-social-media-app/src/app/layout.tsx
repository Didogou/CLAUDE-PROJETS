import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Karine Piffaretti — Social Media",
  description: "Générateur de contenus Instagram & Facebook",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen" style={{ background: "var(--background)" }}>
        {/* Navbar */}
        <nav style={{ background: "var(--green-dark)" }} className="px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-white font-semibold text-lg tracking-wide">
            🌸 Karine · Social Media
          </Link>
          <div className="flex gap-6 text-sm">
            <Link href="/menu" className="text-white/80 hover:text-white transition">📅 Menu</Link>
            <Link href="/recette" className="text-white/80 hover:text-white transition">🍽️ Recette</Link>
            <Link href="/conseil" className="text-white/80 hover:text-white transition">💡 Conseil</Link>
          </div>
        </nav>
        <main className="max-w-4xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
