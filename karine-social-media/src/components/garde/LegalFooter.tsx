import Link from 'next/link';

/**
 * Footer minimaliste avec liens vers les pages obligatoires.
 * Affiché en bas des pages publiques (home notamment).
 *
 * Les 4 pages sont créées en stubs avec un contenu template — il restera
 * à remplir les blancs ([NOM SOCIETE], [SIRET], etc.) avant lancement.
 */
export function LegalFooter() {
  return (
    <footer className="mt-6 border-t border-coral-soft/30 bg-white/50 px-4 py-5 text-center backdrop-blur-sm">
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-ink-soft">
        <li>
          <Link
            href="/mentions-legales"
            className="font-semibold transition hover:text-coral-dark hover:underline"
          >
            Mentions légales
          </Link>
        </li>
        <li className="text-coral-soft" aria-hidden>
          •
        </li>
        <li>
          <Link
            href="/cgu"
            className="font-semibold transition hover:text-coral-dark hover:underline"
          >
            CGU
          </Link>
        </li>
        <li className="text-coral-soft" aria-hidden>
          •
        </li>
        <li>
          <Link
            href="/cgv"
            className="font-semibold transition hover:text-coral-dark hover:underline"
          >
            CGV
          </Link>
        </li>
        <li className="text-coral-soft" aria-hidden>
          •
        </li>
        <li>
          <Link
            href="/confidentialite"
            className="font-semibold transition hover:text-coral-dark hover:underline"
          >
            Confidentialité
          </Link>
        </li>
      </ul>
      <p className="mt-3 text-[0.65rem] text-ink-soft/80">
        © {new Date().getFullYear()} Karine Diététique — Tous droits réservés.
      </p>
    </footer>
  );
}
