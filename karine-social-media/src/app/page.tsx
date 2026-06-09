import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { WelcomeBlock } from '@/components/garde/WelcomeBlock';
import { FeatureTile } from '@/components/garde/FeatureTile';
import { SaviezVousFil } from '@/components/garde/SaviezVousFil';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { LegalFooter } from '@/components/garde/LegalFooter';
import { IdeasFloatingButton } from '@/components/ideas/IdeasFloatingButton';
import { getPublishedFeaturedPhotos } from '@/lib/featured-photos';
import { getUserFavorites } from '@/lib/favorites';
import { discoverPages } from '@/lib/discover-pages';
import { getCurrentUser } from '@/lib/current-user';
import { getAllCapabilities } from '@/lib/capabilities';
import { pathToCapability } from '@/lib/path-to-capability';

export const dynamic = 'force-dynamic';

type TileDef = {
  href: string;
  title: string;
  subtitle: string;
  bgClass: string;
  iconImage: string;
  badge?: string;
  accentImage?: string;
  burstOnClick?: boolean;
};

const TILES: TileDef[] = [
  {
    href: '/menus',
    title: 'Menu de la semaine',
    subtitle: 'Des repas équilibrés\nchaque jour',
    bgClass: 'bg-peach',
    // Vignettes generiques de la version d'il y a 2 jours (avant
    // l'introduction des medaillons aquarelle de la charte Karine).
    iconImage: '/images/icons/ms.webp',
  },
  {
    href: '/recettes',
    title: 'Idées recettes',
    subtitle: 'Inspiration saine\net gourmande',
    bgClass: 'bg-cream',
    iconImage: '/images/icons/ir.webp',
    burstOnClick: true,
  },
  // Tuile "Mon menu" masquée (à réintroduire quand la fonctionnalité
  // personnalisée par profil utilisatrice sera prête).
  {
    href: '/conseils',
    title: 'Conseils santé',
    subtitle: 'Mieux comprendre\nvotre santé',
    bgClass: 'bg-mint',
    iconImage: '/images/icons/cs.webp',
  },
  {
    href: '/astuces',
    title: 'Astuces diététiques',
    subtitle: 'Des astuces simples\nau quotidien',
    bgClass: 'bg-lavender',
    iconImage: '/images/icons/ad.webp',
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

  // Pour chaque tuile, on calcule si l'utilisatrice peut y accéder.
  //   Cas 1 : la page n'existe pas en code → tuile locked d'office
  //   Cas 2 : la page existe + capability associée bloquée pour sans-plan
  //          + user n'a pas de plan → tuile locked
  //
  // ⚠️ UX uniquement. La SÉCURITÉ RÉELLE est dans le proxy
  // (`src/lib/supabase/middleware.ts`) qui bloque l'accès direct à l'URL.
  const discoveredPaths = new Set(discoverPages().map((p) => p.path));
  const userHasPlan =
    user.effectiveRole === 'patient' ||
    user.effectiveRole === 'subscriber' ||
    user.effectiveRole === 'admin';
  const [capabilities, saviezVousPhotos, favRows] = await Promise.all([
    userHasPlan ? Promise.resolve([]) : getAllCapabilities(),
    getPublishedFeaturedPhotos(),
    user.id ? getUserFavorites(user.id) : Promise.resolve([]),
  ]);
  const capByKey = new Map(capabilities.map((c) => [c.key, c]));
  const favoritedFeaturedIds = new Set(
    favRows.filter((r) => r.targetType === 'featured').map((r) => r.targetId),
  );

  const tilesWithAccess = TILES.map((tile) => {
    if (!discoveredPaths.has(tile.href)) {
      return { ...tile, locked: true };
    }
    if (userHasPlan) return { ...tile, locked: false };
    // Sans plan : la tuile est lockée si la capability d'entrée
    // de la section est désactivée (allowed_without_plan = false)
    const capKey = pathToCapability(tile.href);
    if (!capKey) return { ...tile, locked: false };
    const cap = capByKey.get(capKey);
    const locked = !(cap?.allowedWithoutPlan ?? false);
    return { ...tile, locked };
  });

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />

      {/* AppHeader DOIT être enfant direct du flex parent <div.min-h-screen>
          pour que `sticky top-0` fonctionne tout au long du scroll.
          Avant : il était dans un sous-<div relative> qui scopait le
          sticky → l'header décollait dès que WelcomeBlock sortait de
          la viewport (= quand les premières tuiles arrivaient à son
          niveau). Le WelcomeBlock reste à son tour enfant direct, il
          n'a pas besoin du wrapper. */}
      {/* "Une idée ?" est maintenant un FAB flottant en bas à droite
          (cf. <IdeasFloatingButton variant="fab" /> plus bas), donc le
          header n'a plus besoin de la 2e ligne. AppHeader sans withIdeas. */}
      <AppHeader />
      <WelcomeBlock />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 lg:max-w-7xl lg:px-10 lg:pb-4">
        <div className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-4">
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
              burstOnClick={tile.burstOnClick}
            />
          ))}
        </div>

        {saviezVousPhotos.length > 0 && (
          <div className="mt-3 lg:mt-4">
            <SaviezVousFil
              items={saviezVousPhotos.map((p) => ({
                id: String(p.id),
                imageUrl: p.imageUrl,
                caption: p.caption,
                likesCount: p.likesCount,
              }))}
              isAuthenticated={user.isAuthenticated}
              favoritedIds={favoritedFeaturedIds}
            />
          </div>
        )}
      </main>

      <LegalFooter />

      {/* FAB "Une idée" flottant en bas-droite, au-dessus de la
          BottomNav. Toujours visible, persistant au scroll, mais
          discret (icone seule). Remplace l'ancien pill en 2e ligne
          du header. Réservé à la home (canal feedback principal). */}
      <IdeasFloatingButton variant="fab" />

      <BottomNav />
    </div>
  );
}
