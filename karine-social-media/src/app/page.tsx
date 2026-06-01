import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { WelcomeBlock } from '@/components/garde/WelcomeBlock';
import { FeatureTile } from '@/components/garde/FeatureTile';
import { MaJourneeCard } from '@/components/garde/MaJourneeCard';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { findPermissionForPath } from '@/lib/page-permissions';
import { getCurrentUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

type TileDef = {
  href: string;
  title: string;
  subtitle: string;
  bgClass: string;
  iconImage: string;
  badge?: string;
  accentImage?: string;
};

const TILES: TileDef[] = [
  {
    href: '/menus',
    title: 'Menu de la semaine',
    subtitle: 'Des repas équilibrés\nchaque jour',
    bgClass: 'bg-peach',
    iconImage: '/images/icons/ms.png',
  },
  {
    href: '/recettes',
    title: 'Idées recettes',
    subtitle: 'Inspiration saine\net gourmande',
    bgClass: 'bg-cream',
    iconImage: '/images/icons/ir.png',
  },
  {
    href: '/mon-menu',
    title: 'Mon menu',
    subtitle: 'Adapté à vos besoins\net objectifs',
    bgClass: 'bg-petal',
    iconImage: '/images/icons/mp.png',
    badge: 'Nouveau',
    accentImage: '/images/exclamations.png',
  },
  {
    href: '/conseils',
    title: 'Conseils santé',
    subtitle: 'Mieux comprendre\nvotre santé',
    bgClass: 'bg-mint',
    iconImage: '/images/icons/cs.png',
  },
  {
    href: '/astuces',
    title: 'Astuces diététiques',
    subtitle: 'Des astuces simples\nau quotidien',
    bgClass: 'bg-lavender',
    iconImage: '/images/icons/ad.png',
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Auto-redirect admin → /admin (sauf si on force la vue abonné via ?as=visitor)
  if (params.as !== 'visitor' && user.isAdmin) {
    redirect('/admin');
  }

  // Pour chaque tuile, on calcule si l'utilisatrice peut y accéder selon son rôle
  // effectif et la règle page_permissions correspondante. Si pas le bon rôle →
  // la tuile est "locked" et ouvre une modal paywall au clic au lieu de naviguer.
  //
  // ⚠️ Cette détection est UNIQUEMENT pour l'UX. La SÉCURITÉ RÉELLE est dans
  // le proxy (`src/lib/supabase/middleware.ts`) qui bloque l'accès direct à l'URL.
  // Un user qui tape /conseils dans la barre d'adresse sans être abonné est
  // toujours redirigé vers /login. La tuile "locked" évite juste la confusion.
  const tilesWithAccess = await Promise.all(
    TILES.map(async (tile) => {
      const rule = await findPermissionForPath(tile.href);
      // Pas de règle → page ouverte à tous → tuile cliquable normalement
      if (!rule) return { ...tile, locked: false };
      // Règle → on vérifie si le rôle effectif de l'user est dans allowed_roles
      const locked = !rule.allowedRoles.includes(user.effectiveRole);
      return { ...tile, locked };
    }),
  );

  return (
    <div className="relative flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <FloralBackground />

      <div className="relative">
        <AppHeader />
        <WelcomeBlock />
      </div>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 lg:max-w-7xl lg:justify-center lg:px-10 lg:pb-4">
        <div className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-5">
          {tilesWithAccess.map((tile) => (
            <FeatureTile
              key={tile.href}
              href={tile.href}
              bgClass={tile.bgClass}
              iconImage={tile.iconImage}
              title={tile.title}
              subtitle={tile.subtitle}
              badge={tile.badge}
              accentImage={tile.accentImage}
              locked={tile.locked}
              isAuthenticated={user.isAuthenticated}
            />
          ))}
        </div>

        <div className="mt-3 lg:mt-4">
          <MaJourneeCard />
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
