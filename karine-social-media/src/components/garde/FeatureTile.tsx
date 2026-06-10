'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Lock, type LucideIcon } from 'lucide-react';
import { LockedTileModal } from './LockedTileModal';
import { FireworkBurst } from '@/components/recettes/FireworkBurst';

type FeatureTileProps = {
  href: string;
  title: string;
  subtitle: string;
  /** Couleur de fond de la tuile (ex. bg-peach). */
  bgClass: string;
  /** Illustration en fond transparent, placée dans le cercle blanc (prioritaire). */
  iconImage?: string;
  /** Repli icône lucide si pas d'illustration. */
  icon?: LucideIcon;
  iconClass?: string;
  badge?: string;
  /** Décoration PNG en coin haut-droit (ex. étincelles). */
  accentImage?: string;
  className?: string;
  /** Si true → tuile en mode "réservé" : grisée, cadenas, ouverture modal au clic. */
  locked?: boolean;
  /** Pour personnaliser le contenu de la modal (visiteur vs connecté sans abo). */
  isAuthenticated?: boolean;
  /** Si true → déclenche un feu d'artifice de particules cuisine au clic
   *  avant la navigation (~700ms). Utilisé pour la tuile Recettes. */
  burstOnClick?: boolean;
  /** Echelle de l'icone (en % de la largeur de la tuile). Par defaut
   *  85%. Permet d'agrandir specifiquement certaines tuiles (ex.
   *  "Menu de la semaine" avec scale=110 pour la mettre en avant). */
  iconScale?: number;
};

export function FeatureTile({
  href,
  title,
  subtitle,
  bgClass,
  iconImage,
  icon: Icon,
  iconClass = '',
  badge,
  accentImage,
  className = '',
  locked = false,
  isAuthenticated = false,
  burstOnClick = false,
  iconScale = 85,
}: FeatureTileProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [burstCount, setBurstCount] = useState(0);
  const [busy, setBusy] = useState(false);

  function handleBurstClick(e: React.MouseEvent) {
    if (!burstOnClick || locked || busy) return;
    e.preventDefault();
    setBurstCount((n) => n + 1);
    setBusy(true);
    window.setTimeout(() => router.push(href), 700);
  }

  const innerContent = (
    <>
      {/* Feu d'artifice au clic (visible 1.6s, key change pour remount) */}
      {burstOnClick && burstCount > 0 && (
        <span
          key={burstCount}
          className="pointer-events-none absolute inset-0 z-20"
          aria-hidden
        >
          <FireworkBurst category="plat" count={14} />
        </span>
      )}

      {badge && (
        <span
          className={`absolute top-3 z-10 rounded-full bg-sage px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-white ${
            accentImage ? 'left-3' : 'right-3'
          }`}
        >
          {badge}
        </span>
      )}

      {accentImage && (
        <span
          aria-hidden
          className="absolute -right-3 -top-3 z-10 h-28 w-28 bg-contain bg-right-top bg-no-repeat"
          style={{ backgroundImage: `url(${accentImage})` }}
        />
      )}

      {/* Cadenas en haut-gauche si tuile locked */}
      {locked && (
        <span
          aria-hidden
          className="absolute left-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-white/95 text-coral shadow-sm ring-1 ring-coral-soft"
        >
          <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
        </span>
      )}

      {/* Next/Image + fill + sizes : Next genere automatiquement les
          versions AVIF/WebP et choisit la resolution adaptee a chaque
          ecran via srcset.
          quality=95 (vs default 75) : les illustrations aquarelle
          Karine ont des transitions subtiles qui se compressent mal
          en JPEG/WebP low-quality → on monte au max pour preserver
          la nettete. Poids legerement plus eleve mais visuel propre. */}
      {iconImage ? (
        <div
          className="relative block w-full overflow-hidden"
          style={{ aspectRatio: '4 / 5' }}
        >
          <Image
            src={iconImage}
            alt=""
            fill
            sizes="(max-width: 1024px) 50vw, 25vw"
            // Toutes les images sources sont en 4:5 strict (Karine
            // exporte en 2244x2805 ou equivalent) → object-cover
            // remplit bord a bord sans crop visible.
            className="object-cover"
          />
        </div>
      ) : (
        Icon && (
          <span className="grid h-32 w-full place-items-center bg-coral-soft/20">
            <Icon className={`h-12 w-12 ${iconClass}`} strokeWidth={2} />
          </span>
        )
      )}

      {/* Titre + subtitle gardes en sr-only pour SEO / accessibilite,
          mais cachés visuellement (deja dans l'image). */}
      <span className="sr-only">
        {title}
        {subtitle ? ` — ${subtitle.replace(/\n/g, ' ')}` : ''}
      </span>
    </>
  );

  // Forme RECTANGLE 4:5 portrait. Coins tres arrondis + shadow
  // marquee pour le relief. L'image fait tout : titre + subtitle +
  // fleche, donc on n'a pas besoin de padding interne — l'image
  // touche les 4 bords.
  const baseClass = `group relative block overflow-hidden rounded-3xl shadow-md transition ${bgClass} ${className}`;
  const lockedClass = locked
    ? 'opacity-65 saturate-75 hover:opacity-80 hover:shadow-md'
    : 'hover:-translate-y-0.5 hover:shadow-md';

  if (locked) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={`${baseClass} ${lockedClass} cursor-pointer text-left`}
        >
          {innerContent}
        </button>
        <LockedTileModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          tileTitle={title}
          isAuthenticated={isAuthenticated}
        />
      </>
    );
  }

  return (
    <Link
      href={href}
      onClick={burstOnClick ? handleBurstClick : undefined}
      className={`${baseClass} ${lockedClass}`}
    >
      {innerContent}
    </Link>
  );
}
