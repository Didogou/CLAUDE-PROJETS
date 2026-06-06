import { redirect } from 'next/navigation';
import { HeartHandshake } from 'lucide-react';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { FavoriteCard } from '@/components/favorites/FavoriteCard';
import { getCurrentUser } from '@/lib/current-user';
import { enrichFavorites, getUserFavorites } from '@/lib/favorites';
import {
  FAVORITE_GROUP_LABELS,
  FAVORITE_TYPES,
  type FavoriteItem,
} from '@/data/favorites';

export const dynamic = 'force-dynamic';

export default async function FavorisPage() {
  const user = await getCurrentUser();

  if (!user.isAuthenticated || !user.id) {
    redirect('/login?next=/favoris');
  }

  const rows = await getUserFavorites(user.id);
  const items = await enrichFavorites(rows);

  // Groupe par type
  const grouped = new Map<string, FavoriteItem[]>();
  for (const item of items) {
    const arr = grouped.get(item.targetType) ?? [];
    arr.push(item);
    grouped.set(item.targetType, arr);
  }

  const hasAny = items.length > 0;

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-4xl xl:max-w-5xl">
        <h1 className="mb-2 font-script text-4xl text-coral lg:text-5xl">Mes favoris</h1>
        <p className="mb-5 text-xs italic text-ink-soft lg:text-sm">
          Tout ce que tu as mis de côté, classé par catégorie.
        </p>

        {!hasAny ? (
          <div className="space-y-3 rounded-2xl bg-white/85 p-6 text-center shadow-sm">
            <HeartHandshake className="mx-auto h-10 w-10 text-coral" />
            <p className="text-sm font-semibold text-ink">Aucun favori pour l’instant</p>
            <p className="text-xs text-ink-soft">
              Clique sur le ❤️ sur une recette, un menu, une astuce ou un conseil
              pour le retrouver ici.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {FAVORITE_TYPES.map((type) => {
              const arr = grouped.get(type);
              if (!arr || arr.length === 0) return null;
              return (
                <section key={type}>
                  <h2 className="mb-2 font-script text-2xl text-coral-dark">
                    {FAVORITE_GROUP_LABELS[type]} ({arr.length})
                  </h2>
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {arr.map((item) => (
                      <li key={`${item.targetType}-${item.targetId}`}>
                        <FavoriteCard item={item} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
