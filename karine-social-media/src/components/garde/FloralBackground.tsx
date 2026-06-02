import { BACKGROUND_VARIANTS, type BackgroundVariantKey } from '@/data/background-images';
import { getBackgroundOverrides } from '@/lib/background-images';

// Fond floral partagé (mobile portrait / desktop paysage).
// Karine peut surcharger chaque variant depuis /admin/parametres/fonds.
// Si rien en DB → fallback vers le fichier livré /images/fond-*.webp.

export type BackgroundVariant = BackgroundVariantKey;

export async function FloralBackground({
  variant = 'default',
}: {
  variant?: BackgroundVariant;
}) {
  const meta = BACKGROUND_VARIANTS.find((v) => v.key === variant);
  const fallbackPortrait = meta?.fallbackPortrait ?? '/images/fond-portrait.webp';
  const fallbackPaysage = meta?.fallbackPaysage ?? '/images/fond-paysage.webp';

  // try/catch : si table absente (migration pas encore appliquée),
  // on retombe sur les fallbacks sans planter la page.
  let portrait = fallbackPortrait;
  let paysage = fallbackPaysage;
  try {
    const overrides = await getBackgroundOverrides();
    const o = overrides.get(variant);
    if (o?.portraitUrl) portrait = o.portraitUrl;
    if (o?.paysageUrl) paysage = o.paysageUrl;
  } catch {
    /* table absente ou erreur : on garde les fallbacks */
  }

  return (
    <>
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat lg:hidden"
        style={{ backgroundImage: `url('${portrait}')` }}
      />
      <div
        aria-hidden
        className="fixed inset-0 -z-10 hidden bg-cover bg-center bg-no-repeat lg:block"
        style={{ backgroundImage: `url('${paysage}')` }}
      />
    </>
  );
}
