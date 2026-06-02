import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getAllAdviceAdmin } from '@/lib/advice';
import { AdviceRowActions } from '@/components/admin/AdviceRowActions';

export const dynamic = 'force-dynamic';

export default async function AdminConseilsPage() {
  const items = await getAllAdviceAdmin();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Contenu</p>
          <h2 className="font-script text-4xl text-admin-primary-dark">Conseils santé</h2>
        </header>
        <Link
          href="/admin/conseils/new"
          className="flex items-center gap-2 rounded-full bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark"
        >
          <Plus className="h-4 w-4" /> Nouveau
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
          Aucun conseil pour l&apos;instant. Clique sur «&nbsp;Nouveau&nbsp;».
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-2xl bg-admin-surface p-3 shadow-sm"
            >
              <Link
                href={`/admin/conseils/${t.id}`}
                aria-label={`Modifier ${t.label}`}
                className="flex min-w-0 flex-1 items-center gap-3 transition hover:opacity-80"
              >
                <span
                  aria-hidden
                  className="block h-16 w-16 shrink-0 rounded-xl bg-cover bg-center"
                  style={{ backgroundImage: `url(${t.slides[0] ?? ''})` }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-admin-ink">{t.label}</p>
                  <p className="text-xs text-admin-ink-soft">
                    {t.slides.length} slide{t.slides.length > 1 ? 's' : ''}
                    {t.tags.length > 0 ? ` · ${t.tags.join(', ')}` : ''}
                  </p>
                </div>
              </Link>
              <span
                className={`hidden rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide sm:inline-flex ${
                  t.status === 'published'
                    ? 'bg-admin-primary text-white'
                    : 'bg-admin-soft text-admin-ink'
                }`}
              >
                {t.status}
              </span>
              <AdviceRowActions slug={t.id} label={t.label} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
