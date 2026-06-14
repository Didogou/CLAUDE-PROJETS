import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from '@/components/garde/AppHeader';
import { WelcomeBlock } from '@/components/garde/WelcomeBlock';
import { FeatureTile } from '@/components/garde/FeatureTile';
import { SaviezVousFil } from '@/components/garde/SaviezVousFil';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
// LegalFooter déplacé vers /a-propos (2026-06-11). L'utilisatrice accède
// aux infos légales via le menu burger → À propos.
import { getCachedFeaturedPhotos } from '@/lib/cached-content';
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
  /** Echelle de l'icone en % de la largeur de la tuile (default 85). */
  iconScale?: number;
};

const TILES: TileDef[] = [
  {
    href: '/menus',
    title: 'Menu de la semaine',
    subtitle: 'Des repas équilibrés\nchaque jour',
    bgClass: 'bg-white',
    iconImage: '/images/icons/tile-menu-v7.webp',
  },
  {
    href: '/recettes',
    title: 'Idées recettes',
    subtitle: 'Inspiration saine\net gourmande',
    bgClass: 'bg-white',
    iconImage: '/images/icons/new-recettes-v8.webp',
    burstOnClick: true,
  },
  {
    href: '/conseils',
    title: 'Conseils santé',
    subtitle: 'Mieux comprendre\nvotre santé',
    bgClass: 'bg-white',
    iconImage: '/images/icons/new-sante-v6.webp',
  },
  {
    href: '/astuces',
    title: 'Astuces diététiques',
    subtitle: 'Des astuces simples\nau quotidien',
    bgClass: 'bg-white',
    iconImage: '/images/icons/new-astuces-v10.webp',
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
    getCachedFeaturedPhotos(),
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
      <FloralBackground variant="accueil" />

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
      {/* homeExtraTop : pousse le wordmark "Karine Diététique" un peu
          plus bas pour aérer le haut de la page d'accueil (UX 2026-06-12). */}
      <AppHeader homeExtraTop />
      <WelcomeBlock />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 pt-3 lg:max-w-7xl lg:px-10 lg:pb-4">
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
              iconScale={tile.iconScale}
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

        {/* ⚠️ TEMPORAIRE — bouton de validation caméra Phase 3. À retirer
            une fois la caméra in-app validée sur les appareils cibles.
            Pas d'abonné en prod, donc visible sans risque pour le moment. */}
        <Link
          href="/camera-test"
          className="mx-auto mt-4 block w-fit rounded-full border border-dashed border-coral/60 px-4 py-2 text-center text-xs font-semibold text-coral-dark"
        >
          🧪 Test caméra (Phase 3)
        </Link>
      </main>

      {/* L'ampoule "Une idée" est integree dans la BottomNav home
          (a droite du FAB camera, taille inline-small) — pas besoin
          de la dupliquer en FAB fixe. */}

      <BottomNav />
    </div>
  );
}
