'use client';

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from 'react';
import { X, Check, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { DrumPicker } from '@/components/ui/DrumPicker';

// Options pour le drum picker grammes : pas de 25g de 25 à 500g.
// Couvre les usages courants (25-50g = portion légère, 100-150g =
// portion normale, 200g+ = grosse portion). Si l'utilisatrice a besoin
// d'une valeur intermédiaire, elle prend la plus proche.
const GRAMS_OPTIONS = [
  25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 450, 500,
];

// Options pour le drum picker quantité (nombre de portions).
// 0.5 → 5 par pas de 0.5 : couvre demi-portion, portion normale,
// double, triple… au-delà de 5 c'est rare.
const QUANTITY_OPTIONS = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5,
];

// Options pour le drum picker taille (3 paliers).
const SIZE_OPTIONS: SizeBucket[] = ['small', 'medium', 'large'];
const SIZE_LABEL_FR: Record<SizeBucket, string> = {
  small: 'Petit',
  medium: 'Moyen',
  large: 'Grand',
};

/** "1" / "1,5" / "0,5" pour affichage FR. */
function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

/**
 * Niveau de "richesse" d'une macro (pour 100g) sur 4 paliers :
 *   1 = faible, 2 = moyen, 3 = riche, 4 = très riche.
 * Seuils ANSES / consensus diététique courant.
 */
type MacroKind = 'P' | 'L' | 'G';
function macroLevel(kind: MacroKind, g: number): 1 | 2 | 3 | 4 {
  if (kind === 'P') {
    if (g < 5) return 1;
    if (g < 15) return 2;
    if (g < 25) return 3;
    return 4;
  }
  if (kind === 'L') {
    if (g < 3) return 1;
    if (g < 15) return 2;
    if (g < 30) return 3;
    return 4;
  }
  // Glucides
  if (g < 5) return 1;
  if (g < 30) return 2;
  if (g < 60) return 3;
  return 4;
}

// Couleurs Karine : Protéines vert (constructeur muscle),
// Lipides jaune (gras), Glucides rose (énergie / coral du thème).
const MACRO_TEXT_COLOR: Record<MacroKind, string> = {
  P: 'text-emerald-700',
  L: 'text-yellow-700',
  G: 'text-rose-700',
};
const MACRO_DOT_ON: Record<MacroKind, string> = {
  P: 'bg-emerald-500',
  L: 'bg-yellow-500',
  G: 'bg-rose-500',
};

const MACRO_LABEL: Record<MacroKind, string> = {
  P: 'Protéines',
  L: 'Lipides',
  G: 'Glucides',
};

/**
 * Badge macro avec libellé en toutes lettres + valeur + 4 pastilles
 * "batterie" indiquant la richesse pour 100g.
 */
function MacroBadge({ kind, value }: { kind: MacroKind; value: number }) {
  const level = macroLevel(kind, value);
  return (
    <span
      title={`${MACRO_LABEL[kind]} : ${Math.round(value)}g pour 100g`}
      className={`flex flex-col items-center leading-tight ${MACRO_TEXT_COLOR[kind]}`}
    >
      <span className="font-semibold">
        {MACRO_LABEL[kind]} {Math.round(value)}g
      </span>
      <span className="mt-0.5 flex items-center gap-[1px]">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`size-1.5 rounded-full ${
              i <= level ? MACRO_DOT_ON[kind] : 'bg-ink-soft/25'
            }`}
          />
        ))}
      </span>
    </span>
  );
}

// Types redéclarés ici pour éviter le couplage fort avec la sheet V2
// (qui les déclare en interne). Match structurellement.

export type CiqualCandidate = {
  ciqualId: number;
  alimCode: number;
  name: string;
  kcalPer100g: number | null;
  proteinsG?: number | null;
  lipidsG?: number | null;
  carbsG?: number | null;
};

export type SizeBucket = 'small' | 'medium' | 'large';

export type AccompanimentSuggestion = {
  name: string;
  typicalG: number;
  kcalEstimate: number;
};

export type ParsedItem = {
  label: string;
  searchQuery: string;
  portions: number;
  approxGrams: number;
  baseGramsBeforeSizeHint?: number;
  match: CiqualCandidate | null;
  kcalPerPortion: number | null;
  proteinsPerPortion: number | null;
  lipidsPerPortion: number | null;
  carbsPerPortion: number | null;
  topCandidates?: CiqualCandidate[];
  foodKeyword?: string;
  sizeVariability?: 'low' | 'medium' | 'high';
  sizeHint?: SizeBucket | null;
  possibleAccompaniments?: AccompanimentSuggestion[];
};

// Bucket public Supabase Karine où les vignettes Ciqual sont uploadées
// par le batch hero. Quand le batch finit (~17h), chaque alim_code
// aura sa vignette WebP. En attendant, fallback PNG meal.
const CIQUAL_IMAGE_BASE =
  'https://umjdqwjgccodmjummoga.supabase.co/storage/v1/object/public/ciqual-images';
const FALLBACK_IMAGE = '/icons/meals/breakfast.png';

function imageUrlFor(candidate: CiqualCandidate): string {
  return `${CIQUAL_IMAGE_BASE}/${candidate.alimCode}.webp`;
}

/**
 * Carrousel horizontal de cards candidats Ciqual pour un aliment
 * parsé par Mistral.
 *
 * - 1 card par candidat (image + nom + kcal pour 100g)
 * - Scroll snap horizontal — swipe = sélection du candidat visible
 * - Indicateur de position si plusieurs candidats
 * - Sous la card : édition g + qté (drum pickers à ajouter ensuite)
 * - Accompagnements en vignettes cliquables (à ajouter ensuite)
 *
 * Drop-in replacement de l'ancien <ItemBlock /> — même API de props.
 */
export function IngredientCardCarousel({
  item,
  showCalories,
  accQuantities,
  onIncrementAcc,
  onDecrementAcc,
  onPortionsChange,
  onGramsChange,
  onPickCandidate,
  onRemove,
  onSizeChange,
  /** Si fournis, affiche les FABs ✓ vert / × rouge dans la card.
   *  N'envoyer que sur la PREMIÈRE card du preview pour éviter
   *  les doublons (ils valident/annulent TOUT le preview). */
  onConfirmAll,
  onCancelAll,
  confirming = false,
}: {
  item: ParsedItem;
  showCalories: boolean;
  /** Quantité actuelle de chaque accompagnement (vide si pas ajouté). */
  accQuantities: Map<number, number>;
  onIncrementAcc: (accIdx: number) => void;
  onDecrementAcc: (accIdx: number) => void;
  onPortionsChange: (n: number) => void;
  onGramsChange: (g: number) => void;
  onPickCandidate: (c: CiqualCandidate) => void;
  onRemove: () => void;
  onSizeChange: (bucket: SizeBucket) => void;
  onConfirmAll?: () => void;
  onCancelAll?: () => void;
  confirming?: boolean;
}) {
  const candidates = item.topCandidates ?? [];
  const hasCandidates = candidates.length > 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Index courant déduit du scroll-snap (mis à jour onScroll)
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    const idx = candidates.findIndex(
      (c) => item.match?.alimCode === c.alimCode,
    );
    return idx >= 0 ? idx : 0;
  });
  const [gramsPickerOpen, setGramsPickerOpen] = useState(false);
  const [qtyPickerOpen, setQtyPickerOpen] = useState(false);
  const [sizePickerOpen, setSizePickerOpen] = useState(false);

  // Quand l'utilisatrice swipe → on déduit l'index visible centré
  // et on déclenche onPickCandidate (la card visible est SÉLECTIONNÉE).
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.clientWidth;
    if (cardWidth === 0) return;
    const idx = Math.round(el.scrollLeft / cardWidth);
    const clamped = Math.max(0, Math.min(candidates.length - 1, idx));
    if (clamped !== activeIdx) {
      setActiveIdx(clamped);
      const candidate = candidates[clamped];
      if (candidate && item.match?.alimCode !== candidate.alimCode) {
        onPickCandidate(candidate);
      }
    }
  }

  function scrollToIndex(idx: number) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  }

  if (!hasCandidates) {
    // Cas dégénéré : Mistral n'a pas trouvé de candidats Ciqual.
    return (
      <article className="rounded-2xl border border-coral-soft/40 bg-cream/30 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-ink">{item.label}</p>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Retirer cet aliment"
            className="rounded-full p-1 text-ink-soft hover:bg-rose-50 hover:text-rose-600"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1 text-xs italic text-ink-soft">
          Aucun candidat Ciqual. Cet aliment ne sera pas ajouté.
        </p>
      </article>
    );
  }

  return (
    <article className="space-y-2 rounded-2xl border border-coral-soft/40 bg-white p-3 shadow-sm">
      {/* Compteur de position du carrousel TOUT EN HAUT — juste sous
          la bordure de la frame. Indique "tu es sur le candidat X/Y". */}
      {candidates.length > 1 && (
        <div className="flex justify-center">
          <span className="rounded-full bg-coral-soft/40 px-3 py-0.5 text-xs font-bold text-coral-dark">
            {activeIdx + 1} / {candidates.length}
          </span>
        </div>
      )}

      {/* Header : titre = nom du candidat Ciqual SÉLECTIONNÉ.
          Change quand on swipe le carrousel. Wrap sur 2 lignes max
          pour ne pas tronquer les noms longs ("Banane, chair sans
          peau, crue" ne tient pas sur 1 ligne). */}
      <div className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 flex-1 line-clamp-2 text-base font-bold leading-tight text-ink">
          {item.match?.name ??
            (item.foodKeyword
              ? item.foodKeyword.charAt(0).toUpperCase() +
                item.foodKeyword.slice(1)
              : item.label)}
        </h4>
        {(onConfirmAll || onCancelAll) && (
          <div className="flex shrink-0 gap-2">
            {onConfirmAll && (
              <button
                type="button"
                onClick={onConfirmAll}
                disabled={confirming}
                aria-label="Valider et ajouter"
                className="grid size-10 place-items-center rounded-full bg-emerald-500 text-white shadow-md transition hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                {confirming ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Check className="size-5" strokeWidth={3} />
                )}
              </button>
            )}
            {onCancelAll && (
              <button
                type="button"
                onClick={onCancelAll}
                aria-label="Fermer / annuler"
                className="grid size-10 place-items-center rounded-full bg-rose-500 text-white shadow-md transition hover:scale-105 active:scale-95"
              >
                <X className="size-5" strokeWidth={3} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Carrousel horizontal des candidats */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex w-full snap-x snap-mandatory overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-x pan-y',
          }}
        >
          {candidates.map((c) => {
            const isSelected = item.match?.alimCode === c.alimCode;
            return (
              <div
                key={c.alimCode}
                className="flex w-full shrink-0 snap-center flex-col items-center px-2 py-2"
              >
                {/* Zone image : juste un fond neutre transparent.
                    Le dégradé rose→bleu est porté par la sub-page. */}
                <div className="relative grid size-56 place-items-center rounded-3xl bg-white/40">
                  <img
                    src={imageUrlFor(c)}
                    onError={(e) => {
                      // Fallback discret si la vignette Ciqual n'existe
                      // pas encore (batch en cours). 1 seule retry.
                      const img = e.currentTarget;
                      if (img.dataset.fallback !== '1') {
                        img.dataset.fallback = '1';
                        img.src = FALLBACK_IMAGE;
                      }
                    }}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="size-52 object-contain"
                  />
                </div>
                {/* KCAL + "pour 100 g" groupés sur une ligne. */}
                {c.kcalPer100g != null && (
                  <p className="mt-2 text-center leading-tight">
                    <span className="text-2xl font-extrabold text-coral-dark">
                      {Math.round(c.kcalPer100g)} kcal
                    </span>
                    <span className="ml-2 text-xs font-semibold text-ink-soft">
                      pour 100&nbsp;g
                    </span>
                  </p>
                )}
                {/* Macros P / L / G en 3 colonnes — toujours sur
                    UNE seule ligne pour comparaison visuelle directe.
                    Texte rétréci pour que ça tienne sans wrap. */}
                <div className="mt-1 grid grid-cols-3 gap-x-1 text-[0.6rem]">
                  <div className="flex justify-center">
                    {c.proteinsG != null && (
                      <MacroBadge kind="P" value={c.proteinsG} />
                    )}
                  </div>
                  <div className="flex justify-center">
                    {c.lipidsG != null && (
                      <MacroBadge kind="L" value={c.lipidsG} />
                    )}
                  </div>
                  <div className="flex justify-center">
                    {c.carbsG != null && (
                      <MacroBadge kind="G" value={c.carbsG} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Flèches gauche/droite si plusieurs candidats */}
        {candidates.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => scrollToIndex(Math.max(0, activeIdx - 1))}
              disabled={activeIdx === 0}
              aria-label="Candidat précédent"
              className="absolute left-0 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-md ring-1 ring-coral-soft transition hover:bg-coral-soft/30 disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                scrollToIndex(
                  Math.min(candidates.length - 1, activeIdx + 1),
                )
              }
              disabled={activeIdx === candidates.length - 1}
              aria-label="Candidat suivant"
              className="absolute right-0 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-white text-coral shadow-md ring-1 ring-coral-soft transition hover:bg-coral-soft/30 disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </>
        )}
      </div>

      {/* Indicateur dots de position */}
      {candidates.length > 1 && (
        <div className="flex items-center justify-center gap-1">
          {candidates.map((c, idx) => (
            <button
              key={c.alimCode}
              type="button"
              onClick={() => scrollToIndex(idx)}
              aria-label={`Aller au candidat ${idx + 1}`}
              className={`size-1.5 rounded-full transition ${
                idx === activeIdx ? 'bg-coral' : 'bg-coral-soft/50'
              }`}
            />
          ))}
        </div>
      )}


      {/* Édition g + qté + taille — picker drum pour les grammes
          (cliquer = ouvre la liste qui scroll). Qté et taille en
          attente, on les passera aussi en drum ensuite. */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-cream/30 p-2">
        <button
          type="button"
          onClick={() => setGramsPickerOpen(true)}
          className="flex flex-col items-start text-left text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft active:opacity-70"
        >
          Grammes
          <span className="mt-0.5 w-full rounded border border-coral-soft bg-white px-2 py-1 text-center text-sm font-bold text-ink">
            {item.approxGrams}&nbsp;g
          </span>
        </button>
        <button
          type="button"
          onClick={() => setQtyPickerOpen(true)}
          className="flex flex-col items-start text-left text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft active:opacity-70"
        >
          Quantité
          <span className="mt-0.5 w-full rounded border border-coral-soft bg-white px-2 py-1 text-center text-sm font-bold text-ink">
            {formatQty(item.portions)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSizePickerOpen(true)}
          className="flex flex-col items-start text-left text-[0.65rem] font-semibold uppercase tracking-wider text-ink-soft active:opacity-70"
        >
          Taille
          <span className="mt-0.5 w-full rounded border border-coral-soft bg-white px-2 py-1 text-center text-sm font-bold text-ink">
            {SIZE_LABEL_FR[item.sizeHint ?? 'medium']}
          </span>
        </button>
      </div>

      {/* Pas de bandeau Total ici — kcal/100g sous l'image suffit.
          Le total pour la portion sera réintégré ailleurs quand on
          ajoutera les drum pickers (g/qté). */}

      {/* Accompagnements suggérés style "menu McDo" : grosses
          vignettes carrées avec image + nom + bouton +. Click + =
          +1 portion (compteur incrémental). Long-press / click sur
          le badge = -1. */}
      {item.possibleAccompaniments && item.possibleAccompaniments.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 pb-1" style={{ scrollbarWidth: 'none' }}>
          {item.possibleAccompaniments.map((acc, accIdx) => {
            const qty = accQuantities.get(accIdx) ?? 0;
            return (
              <AccompanimentTile
                key={accIdx}
                acc={acc}
                quantity={qty}
                onIncrement={() => onIncrementAcc(accIdx)}
                onDecrement={() => onDecrementAcc(accIdx)}
                showCalories={showCalories}
              />
            );
          })}
        </div>
      )}

      {/* Drum picker grammes — overlay portal, monté à la demande */}
      {gramsPickerOpen && (
        <DrumPicker
          title="Choisis la quantité (g)"
          options={GRAMS_OPTIONS}
          current={item.approxGrams}
          formatLabel={(g) => `${g} g`}
          accent="coral"
          onClose={() => setGramsPickerOpen(false)}
          onPick={(g) => {
            onGramsChange(g);
            setGramsPickerOpen(false);
          }}
        />
      )}

      {/* Drum picker quantité (portions) */}
      {qtyPickerOpen && (
        <DrumPicker
          title="Combien de portions ?"
          options={QUANTITY_OPTIONS}
          current={item.portions}
          formatLabel={(n) =>
            n === 1 ? '1 portion' : `${formatQty(n)} portions`
          }
          accent="coral"
          onClose={() => setQtyPickerOpen(false)}
          onPick={(n) => {
            onPortionsChange(n);
            setQtyPickerOpen(false);
          }}
        />
      )}

      {/* Drum picker taille (Petit / Moyen / Grand) */}
      {sizePickerOpen && (
        <DrumPicker<SizeBucket>
          title="Taille de la portion"
          options={SIZE_OPTIONS}
          current={item.sizeHint ?? 'medium'}
          formatLabel={(s) => SIZE_LABEL_FR[s]}
          accent="coral"
          onClose={() => setSizePickerOpen(false)}
          onPick={(s) => {
            onSizeChange(s);
            setSizePickerOpen(false);
          }}
        />
      )}
    </article>
  );
}

/**
 * Vignette d'un accompagnement (sucre, beurre, crème, …) style menu
 * McDo : carrée, image centrée, nom dessous + bouton + en surimpression.
 * Une fois sélectionné : bord vert + bouton remplacé par un check vert
 * + badge "+1" en haut à droite.
 */
function AccompanimentTile({
  acc,
  quantity,
  onIncrement,
  onDecrement,
  showCalories,
}: {
  acc: AccompanimentSuggestion;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  showCalories: boolean;
}) {
  const isAdded = quantity > 0;
  // L'image peut ne pas exister dans /icons/accompaniments/.
  // Si onError du <img> se déclenche, on cache l'image (pas d'icon
  // "image broken" disgracieux). La zone reste vide mais propre.
  const [imageOk, setImageOk] = useState(true);
  // Image : on tente /icons/accompaniments/${slug}.png puis fallback.
  // Pour l'instant on retombe direct sur fallback ; quand les vraies
  // images seront produites (sucre.png, beurre.png…), elles seront
  // chargées automatiquement.
  const slug = acc.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (
    <div
      onClick={onIncrement}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onIncrement();
        }
      }}
      className={`relative flex w-20 shrink-0 cursor-pointer flex-col items-center rounded-xl border bg-white p-1.5 transition active:scale-95 ${
        isAdded
          ? 'border-emerald-400 shadow-sm'
          : 'border-coral-soft/40 hover:border-coral'
      }`}
    >
      {/* Image — fond pastel doux derrière. Si l'image n'existe pas,
          on n'affiche RIEN (pas d'icon image-broken). La zone reste
          mais vide. */}
      <div className="grid size-14 place-items-center rounded-lg bg-gradient-to-br from-coral-soft/30 via-pink-50/30 to-sky-100/30">
        {imageOk && (
          <img
            src={`/icons/accompaniments/${slug}.png`}
            onError={() => setImageOk(false)}
            alt=""
            aria-hidden
            draggable={false}
            className="size-12 object-contain"
          />
        )}
      </div>
      {/* Nom + grammes */}
      <p className="mt-0.5 line-clamp-1 text-center text-[0.65rem] font-bold text-ink">
        {acc.name.charAt(0).toUpperCase() + acc.name.slice(1)}
      </p>
      <p className="text-[0.55rem] text-ink-soft">
        {acc.typicalG}g{showCalories && ` · ${acc.kcalEstimate}`}
      </p>
      {/* Bouton + TOUJOURS un + : on peut continuer à incrémenter. */}
      <span
        aria-hidden
        className={`absolute right-0.5 top-12 grid size-5 place-items-center rounded-full text-white shadow ring-1 ring-white ${
          isAdded ? 'bg-emerald-500' : 'bg-coral'
        }`}
      >
        <Plus className="size-3" strokeWidth={3} />
      </span>
      {/* Badge compteur en haut à droite (cliquable pour décrémenter). */}
      {isAdded && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDecrement();
          }}
          aria-label={`Retirer 1 ${acc.name}`}
          className="absolute -right-1 -top-1 grid min-w-[1rem] place-items-center rounded-full bg-emerald-500 px-1 py-[1px] text-[0.6rem] font-bold leading-none text-white shadow ring-1 ring-white transition hover:bg-emerald-600"
        >
          {quantity}
        </button>
      )}
    </div>
  );
}
