import { getCiqualStats } from '@/lib/ciqual';
import { CiqualImportPanel } from '@/components/admin/CiqualImportPanel';

export const dynamic = 'force-dynamic';

export default async function AdminCiqualPage() {
  const stats = await getCiqualStats();
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          R&eacute;f&eacute;rence nutritionnelle
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">
          Base Ciqual ANSES
        </h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Importe ici le fichier officiel <strong>Ciqual</strong> de l&rsquo;ANSES
          (table de composition nutritionnelle des aliments fran&ccedil;ais).
          Cette base alimente le <strong>compteur de calories</strong> des
          abonn&eacute;es : quand elles saisissent &laquo;&nbsp;j&rsquo;ai mang&eacute;
          un yaourt&nbsp;&raquo;, on cherche ici.
        </p>
        <p className="mt-1 text-xs text-admin-ink-soft">
          T&eacute;l&eacute;charge le XLSX sur{' '}
          <a
            href="https://ciqual.anses.fr/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-admin-primary underline"
          >
            ciqual.anses.fr
          </a>{' '}
          (rubrique &laquo;&nbsp;T&eacute;l&eacute;charger les donn&eacute;es&nbsp;&raquo;).
        </p>
      </header>

      <CiqualImportPanel initialStats={stats} />
    </div>
  );
}
