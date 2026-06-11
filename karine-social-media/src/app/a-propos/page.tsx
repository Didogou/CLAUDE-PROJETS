import type { Metadata } from 'next';
import Link from 'next/link';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { getAppSettings } from '@/lib/app-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'À propos · Karine Diététique',
};

/**
 * Page À propos publique.
 *
 *  - En haut : liens vers les pages légales (mentions, CGU, CGV, conf.)
 *    qui étaient dans le footer de la home avant 2026-06-11
 *  - Body : contenu Markdown léger édité par Karine via /admin/parametres
 */
export default async function AProposPage() {
  const settings = await getAppSettings();
  const lines = settings.aboutPageContent.split(/\r?\n/);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader pageTitle="À propos" backHref="/" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-12 pt-2 sm:max-w-2xl">
        {/* Liens légaux EN HAUT (déplacés du footer accueil — 2026-06-11). */}
        <nav
          aria-label="Informations légales"
          className="mb-6 rounded-2xl bg-white/70 p-3 shadow-sm ring-1 ring-coral-soft/40"
        >
          <p className="mb-2 text-[0.65rem] font-bold uppercase tracking-wider text-coral-dark">
            Informations légales
          </p>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <li>
              <Link
                href="/mentions-legales"
                className="font-semibold text-ink-soft transition hover:text-coral-dark hover:underline"
              >
                Mentions légales
              </Link>
            </li>
            <li className="text-coral-soft" aria-hidden>•</li>
            <li>
              <Link
                href="/cgu"
                className="font-semibold text-ink-soft transition hover:text-coral-dark hover:underline"
              >
                CGU
              </Link>
            </li>
            <li className="text-coral-soft" aria-hidden>•</li>
            <li>
              <Link
                href="/cgv"
                className="font-semibold text-ink-soft transition hover:text-coral-dark hover:underline"
              >
                CGV
              </Link>
            </li>
            <li className="text-coral-soft" aria-hidden>•</li>
            <li>
              <Link
                href="/confidentialite"
                className="font-semibold text-ink-soft transition hover:text-coral-dark hover:underline"
              >
                Confidentialité
              </Link>
            </li>
          </ul>
        </nav>

        {/* Contenu éditable depuis l'admin. Markdown très léger :
            # titre, ## sous-titre, paragraphe simple. */}
        <article className="space-y-3 rounded-3xl bg-white/85 p-5 text-sm leading-relaxed text-ink shadow-sm">
          {renderLightMarkdown(lines)}
        </article>

        <p className="mt-6 text-center text-[0.65rem] text-ink-soft/80">
          © {new Date().getFullYear()} Karine Diététique — Tous droits réservés.
        </p>
      </main>
      <BottomNav />
    </div>
  );
}

/** Rendu Markdown ultra-léger : # h1, ## h2, ### h3, ligne vide = nouveau
 *  paragraphe. Pas de lib externe (sécurité + bundle size). */
function renderLightMarkdown(lines: string[]): React.ReactNode {
  const out: React.ReactNode[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(
      <p key={`p-${out.length}`} className="text-sm leading-relaxed text-ink">
        {paragraph.join(' ')}
      </p>,
    );
    paragraph = [];
  };
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushParagraph();
      return;
    }
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      out.push(
        <h3 key={`h3-${i}`} className="font-bold text-coral-dark">
          {trimmed.slice(4)}
        </h3>,
      );
    } else if (trimmed.startsWith('## ')) {
      flushParagraph();
      out.push(
        <h2 key={`h2-${i}`} className="font-script text-2xl text-coral-dark">
          {trimmed.slice(3)}
        </h2>,
      );
    } else if (trimmed.startsWith('# ')) {
      flushParagraph();
      out.push(
        <h1 key={`h1-${i}`} className="font-script text-3xl text-coral">
          {trimmed.slice(2)}
        </h1>,
      );
    } else {
      paragraph.push(trimmed);
    }
  });
  flushParagraph();
  return out;
}
