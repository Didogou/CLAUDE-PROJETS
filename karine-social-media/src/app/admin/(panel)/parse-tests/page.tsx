import { ParseTestsView } from '@/components/admin/ParseTestsView';

export const dynamic = 'force-dynamic';

export default async function AdminParseTestsPage() {
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          QA Recherche
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Tests de parsing
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Outil de v&eacute;rification rapide. Tape une liste de phrases
          (1 par ligne), lance le test, et v&eacute;rifie visuellement que
          Mistral d&eacute;tecte les bons aliments + les bonnes portions.
          Utile apr&egrave;s chaque modification du prompt ou de la grille.
        </p>
      </header>
      <ParseTestsView />
    </div>
  );
}
