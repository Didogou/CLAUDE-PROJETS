import Link from 'next/link';
import { Bell, HeartHandshake, Sparkles } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { MainDrawer } from './MainDrawer';
import { IdeasFloatingButton } from '@/components/ideas/IdeasFloatingButton';
import { getCurrentUser } from '@/lib/current-user';
import { getMyUnreadCount } from '@/lib/notifications';

export async function AppHeader({
  withSlogan = false,
}: {
  withSlogan?: boolean;
}) {
  const user = await getCurrentUser();
  const unreadCount =
    user.isAuthenticated && user.id ? await getMyUnreadCount(user.id) : 0;

  return (
    <header className="sticky top-0 z-40 flex flex-col bg-transparent px-5 py-3 lg:py-5">
      <div className="flex items-center justify-between">
        <MainDrawer
          isAdmin={user.isAdmin}
          isAuthenticated={user.isAuthenticated}
        />

        <Logo slogan={withSlogan} />

        <div className="flex items-center gap-2">
        {/* Bouton "S'abonner" — visible AUTOMATIQUEMENT pour quiconque n'a
            pas d'accès actif (visiteur non connecté OU connecté sans abo /
            patient expiré). Masqué seulement pour patient/subscriber/admin
            actif. C'est notre principal point d'entrée commercial. */}
        {user.effectiveRole === 'visitor' && (
          <Link
            href="/mon-plan"
            aria-label="Voir les abonnements"
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-coral px-3 text-xs font-bold text-white shadow-md ring-1 ring-coral-dark/30 transition hover:scale-105 hover:bg-coral-dark sm:text-sm"
          >
            <Sparkles className="h-4 w-4" strokeWidth={2.2} />
            S&apos;abonner
          </Link>
        )}

        {user.isAuthenticated ? (
          <Link
            href="/notifications"
            aria-label={
              unreadCount > 0
                ? `Notifications (${unreadCount} non lues)`
                : 'Notifications'
            }
            className="relative grid h-10 w-10 place-items-center rounded-full bg-white/50 text-ink backdrop-blur transition hover:bg-white/80"
          >
            <Bell className="h-6 w-6" strokeWidth={2} />
            {unreadCount > 0 && (
              <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-coral px-1 text-[0.6rem] font-bold text-white ring-2 ring-white/80">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
        ) : (
          <Link
            href="/login"
            aria-label="Se connecter"
            className="group flex h-10 items-center gap-1.5 rounded-full border border-coral-soft bg-white px-3 text-xs font-semibold text-coral-dark shadow-sm transition hover:bg-coral-soft/30 sm:text-sm"
          >
            <HeartHandshake
              className="h-4 w-4 transition-transform group-hover:rotate-12"
              strokeWidth={2.2}
            />
            <span className="hidden sm:inline">Se connecter</span>
            <span className="sm:hidden">Login</span>
          </Link>
        )}
        </div>
      </div>

      {/* Ligne 2 : bouton "Une idée ?" centré. Visible uniquement pour
          les utilisatrices authentifiees (la soumission requiert un compte
          pour pouvoir leur notifier la reponse de Karine). */}
      {user.isAuthenticated && (
        <div className="mt-2 flex justify-center">
          <IdeasFloatingButton />
        </div>
      )}
    </header>
  );
}
