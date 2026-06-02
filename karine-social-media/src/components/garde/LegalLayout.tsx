import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AppHeader } from './AppHeader';
import { FloralBackground } from './FloralBackground';
import { LegalFooter } from './LegalFooter';

/**
 * Layout commun aux 4 pages légales : header + fond floral + contenu
 * en colonne max-w-3xl + retour accueil + footer.
 */
export function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-8 pt-2">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-white/60 hover:text-coral-dark"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Retour à l&apos;accueil
        </Link>

        <article className="rounded-2xl bg-white/85 px-5 py-6 shadow-sm backdrop-blur-sm sm:px-8 sm:py-8">
          <header className="mb-4 border-b border-coral-soft/30 pb-4">
            <h1 className="font-script text-4xl text-coral-dark sm:text-5xl">
              {title}
            </h1>
            <p className="mt-1 text-xs text-ink-soft">
              Dernière mise à jour : {lastUpdated}
            </p>
          </header>
          <div className="legal-prose space-y-5 text-sm leading-relaxed text-ink sm:text-base">
            {children}
          </div>
        </article>
      </main>

      <LegalFooter />

      <style>{`
        .legal-prose h2 {
          font-family: var(--font-sans), system-ui, sans-serif;
          font-weight: 700;
          font-size: 1.05rem;
          color: #c75a73;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .legal-prose h3 {
          font-weight: 700;
          font-size: 0.95rem;
          color: #4b4248;
          margin-top: 1rem;
          margin-bottom: 0.3rem;
        }
        .legal-prose p {
          margin: 0.4rem 0;
        }
        .legal-prose ul {
          list-style: disc;
          padding-left: 1.4rem;
          margin: 0.4rem 0;
        }
        .legal-prose li {
          margin: 0.15rem 0;
        }
        .legal-prose .blank {
          display: inline-block;
          padding: 0 0.4rem;
          background: #fde4ea;
          border-radius: 4px;
          color: #c75a73;
          font-weight: 700;
          font-size: 0.85em;
        }
      `}</style>
    </div>
  );
}

/**
 * Composant inline pour marquer les blancs à remplir avant lancement.
 * Visuellement bien visible (badge rose) pour que personne n'oublie.
 */
export function Blank({ children }: { children: React.ReactNode }) {
  return <span className="blank">[{children}]</span>;
}
