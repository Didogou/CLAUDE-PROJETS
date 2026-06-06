import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getAllMenusAdmin } from '@/lib/menus';
import { formatWeekTitle } from '@/data/menus';
import { MenuRowActions } from '@/components/admin/MenuRowActions';
import { MenuPublicToggle } from '@/components/admin/MenuPublicToggle';

export const dynamic = 'force-dynamic';

export default async function AdminMenusPage() {
  const menus = await getAllMenusAdmin();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Contenu</p>
          <h2 className="font-script text-4xl text-admin-primary-dark">Menus de la semaine</h2>
        </header>
        <Link
          href="/admin/menus/bulk-new"
          className="flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark"
        >
          <Plus className="h-4 w-4" /> Nouveau menu
        </Link>
      </div>

      {menus.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Aucun menu pour l&apos;instant. Clique sur «&nbsp;Nouveau&nbsp;».
        </p>
      ) : (
        <ul className="space-y-2">
          {menus.map((m) => {
            const fullTitle = m.title || formatWeekTitle(m.weekStart);
            return (
              <li
                key={m.id}
                className="rounded-2xl bg-admin-surface p-3 shadow-sm"
              >
                {/* Titre pleine largeur en haut, NON tronqué. */}
                <Link
                  href={`/admin/menus/${m.id}`}
                  className="block transition hover:opacity-80"
                >
                  <p className="text-base font-semibold leading-tight text-admin-ink">
                    {fullTitle}
                  </p>
                </Link>

                {/* Ligne actions : image + meta + toggle + crayon + suppr. */}
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={`/admin/menus/${m.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 transition hover:opacity-80"
                  >
                    <span
                      aria-hidden
                      className="block h-16 w-16 shrink-0 rounded-xl bg-cover bg-center"
                      style={{
                        backgroundImage: `url(${m.coverImageUrl || ''})`,
                        backgroundColor: 'var(--color-admin-soft)',
                      }}
                    />
                    <p className="min-w-0 flex-1 truncate text-xs text-admin-ink-soft">
                      {m.days.length} plats · {m.weekStart}
                    </p>
                  </Link>
                  <MenuPublicToggle id={m.id} initial={m.isPublic} />
                  <span
                    className={`hidden rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide sm:inline-flex ${
                      m.status === 'published'
                        ? 'bg-admin-primary text-white'
                        : 'bg-admin-soft text-admin-ink'
                    }`}
                  >
                    {m.status}
                  </span>
                  <MenuRowActions id={m.id} title={fullTitle} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
