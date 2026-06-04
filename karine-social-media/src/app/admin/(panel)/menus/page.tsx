import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getAllMenusAdmin } from '@/lib/menus';
import { formatWeekTitle } from '@/data/menus';
import { MenuRowActions } from '@/components/admin/MenuRowActions';

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
          {menus.map((m) => (
            <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-admin-surface p-3 shadow-sm">
              <span
                aria-hidden
                className="block h-16 w-16 shrink-0 rounded-xl bg-cover bg-center"
                style={{
                  backgroundImage: `url(${m.coverImageUrl || ''})`,
                  backgroundColor: 'var(--color-admin-soft)',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-admin-ink">
                  {m.title || formatWeekTitle(m.weekStart)}
                </p>
                <p className="text-xs text-admin-ink-soft">
                  {m.days.length} plats · {m.weekStart}
                </p>
              </div>
              <span
                className={`hidden rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide sm:inline-flex ${
                  m.status === 'published'
                    ? 'bg-admin-primary text-white'
                    : 'bg-admin-soft text-admin-ink'
                }`}
              >
                {m.status}
              </span>
              <MenuRowActions
                id={m.id}
                title={m.title || formatWeekTitle(m.weekStart)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
