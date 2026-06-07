import { redirect } from 'next/navigation';
import { Archive } from 'lucide-react';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { getCurrentUser } from '@/lib/current-user';
import { getArchivedLists } from '@/lib/shopping-lists';

export const dynamic = 'force-dynamic';

export default async function CoursesHistoriquePage() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    redirect('/login?next=/courses/historique');
  }
  const lists = await getArchivedLists(user.id);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader pageTitle="Historique" backHref="/courses" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-2xl">

        {lists.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-coral-soft/60 bg-white/40 px-4 py-8 text-center text-sm text-ink-soft">
            Tu n&apos;as encore archivé aucune liste. Sauvegarde ta liste actuelle
            depuis la page Courses pour la retrouver ici.
          </p>
        ) : (
          <ul className="space-y-3">
            {lists.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/95 p-4 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-script text-lg text-coral-dark">
                    {l.name}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {l.items.length} article{l.items.length > 1 ? 's' : ''}
                    {l.archivedAt && ` · archivée le ${formatDate(l.archivedAt)}`}
                  </p>
                </div>
                <Archive className="h-5 w-5 shrink-0 text-coral-soft" />
              </li>
            ))}
          </ul>
        )}
      </main>
      <BottomNav />
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
