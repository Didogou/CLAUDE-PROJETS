import Link from 'next/link';
import { Bell, HeartHandshake, Sparkles } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { MainDrawer } from './MainDrawer';
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
    <header className="flex items-center justify-between px-5 py-3 lg:py-5">
      <MainDrawer isAdmin={user.isAdmin} />

      <Logo slogan={withSlogan} />

      {user.isAuthenticated ? (
        <div className="flex items-center gap-2">
          {/* Bouton accès abonnement si connecté MAIS sans accès actif
              (ni patient actif, ni subscriber actif). Discret mais visible. */}
          {user.effectiveRole === 'visitor' && (
            <Link
              href="/mon-plan"
              aria-label="Voir les abonnements"
              className="hidden h-10 items-center gap-1.5 rounded-full bg-coral px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-coral-dark sm:inline-flex"
            >
              <Sparkles className="h-3.5 w-3.5" />
              S&apos;abonner
            </Link>
          )}
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
        </div>
      ) : (
        <Link
          href="/login"
          aria-label="Se connecter"
          className="group flex h-10 items-center gap-1.5 rounded-full bg-coral px-3 text-sm font-semibold text-white shadow-md ring-1 ring-coral-dark/30 transition hover:scale-105 hover:bg-coral-dark sm:px-4"
        >
          <HeartHandshake
            className="h-4 w-4 transition-transform group-hover:rotate-12 sm:h-5 sm:w-5"
            strokeWidth={2.2}
          />
          <span className="hidden sm:inline">Se connecter</span>
          <span className="sm:hidden">Login</span>
        </Link>
      )}
    </header>
  );
}
