'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Share2, Printer, Heart, X, Send, Camera, Clock, CookingPot } from 'lucide-react';
import type { Recipe, RecipeCategory } from '@/data/recipes';
import { SeasonChip } from './SeasonChip';
import { InstaComments } from './InstaComments';
import { FireworkBurst } from './FireworkBurst';
import { compressImage } from '@/lib/compress-image';
import { ZoomableImage } from '@/components/ui/ZoomableImage';

type Comment = {
  id: string | number;
  author: string;
  text: string;
  photos: string[];
  likesCount: number;
  parentId: string | null;
  parentAuthor?: string;
};

export function RecipeDetailView({
  slug,
  title,
  category,
  images,
  prepPhotos,
  suggestions,
  isSeasonal = false,
  prepTimeMin,
  cookTimeMin,
  initialLikes,
  initialComments,
}: {
  slug: string;
  title: string;
  category: RecipeCategory;
  images: string[];
  prepPhotos: string[];
  suggestions: Recipe[];
  isSeasonal?: boolean;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  initialLikes: number;
  initialComments: Comment[];
}) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(initialLikes);
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [draft, setDraft] = useState('');
  const [draftPhotos, setDraftPhotos] = useState<File[]>([]);
  // Si non null, le prochain commentaire posté sera une réponse à ce commentaire
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  // Cœurs flottants spawnés à chaque tap sur le like
  const [floatingHearts, setFloatingHearts] = useState<number[]>([]);
  // Index de la photo prépa zoomée (lightbox local), null = fermé
  const [prepZoomIndex, setPrepZoomIndex] = useState<number | null>(null);

  const isFirst = index === 0;
  const isLast = index === images.length - 1;

  async function toggleLike() {
    // Spawn d'un cœur flottant à chaque tap, même répétés (visuel encourageant).
    const heartId = Date.now() + Math.random();
    setFloatingHearts((arr) => [...arr, heartId]);
    setTimeout(() => setFloatingHearts((arr) => arr.filter((x) => x !== heartId)), 1100);

    // Anti double-like en DB (V1 anonyme).
    if (liked) return;
    setLiked(true);
    setLikes((n) => n + 1);
    try {
      const res = await fetch(`/api/recipes/${slug}/like`, { method: 'POST' });
      const json = await res.json();
      if (res.ok && typeof json.likes === 'number') setLikes(json.likes);
    } catch {
      // silencieux V1 ; on garde l'optimistic update
    }
  }

  async function handleShare() {
    try {
      if (navigator.share) await navigator.share({ title, url: window.location.href });
      else await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* annulé */
    }
  }

  async function addComment(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const photos = [...draftPhotos];
    const targetReply = replyTo;
    // Optimistic update avec previews local
    const tempId = `tmp-${Date.now()}`;
    const localPreviews = photos.map((f) => URL.createObjectURL(f));
    setComments((c) => [
      {
        id: tempId,
        author: 'Vous',
        text,
        photos: localPreviews,
        likesCount: 0,
        parentId: targetReply ? String(targetReply.id) : null,
        parentAuthor: targetReply?.author,
      },
      ...c,
    ]);
    setDraft('');
    setDraftPhotos([]);
    setReplyTo(null);
    try {
      const form = new FormData();
      form.append('body', text);
      if (targetReply) form.append('parentId', String(targetReply.id));
      // Compression côté client avant envoi (anti-413 Vercel)
      for (const f of photos) {
        form.append('photos', await compressImage(f));
      }
      const res = await fetch(`/api/recipes/${slug}/comments`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error();
      const saved = await res.json();
      // Cleanup local previews avant remplacement par URLs serveur
      localPreviews.forEach((u) => URL.revokeObjectURL(u));
      setComments((c) =>
        c.map((x) =>
          x.id === tempId
            ? {
                id: saved.id,
                author: saved.authorName,
                text: saved.body,
                photos: saved.photos ?? [],
                likesCount: saved.likesCount ?? 0,
                parentId: saved.parentId ?? null,
                parentAuthor: targetReply?.author,
              }
            : x,
        ),
      );
    } catch {
      localPreviews.forEach((u) => URL.revokeObjectURL(u));
      setComments((c) => c.filter((x) => x.id !== tempId));
      setDraft(text);
      setDraftPhotos(photos);
      setReplyTo(targetReply);
    }
  }

  async function likeComment(commentId: string | number) {
    // Optimistic
    setComments((c) =>
      c.map((x) => (x.id === commentId ? { ...x, likesCount: x.likesCount + 1 } : x)),
    );
    try {
      const res = await fetch(`/api/comments/${commentId}/like`, { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        if (typeof json.likes === 'number') {
          setComments((c) =>
            c.map((x) => (x.id === commentId ? { ...x, likesCount: json.likes } : x)),
          );
        }
      }
    } catch {
      // silent V1
    }
  }

  // Swipe horizontal pour naviguer entre les slides (vue normale + zoom).
  // Seuil 50 px et déplacement horizontal > vertical pour ignorer le scroll.
  const swipeStart = useRef({ x: 0, y: 0 });
  function onSwipeStart(e: React.TouchEvent) {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY };
  }
  function onSwipeEnd(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && !isLast) setIndex((i) => i + 1);
    else if (dx > 0 && !isFirst) setIndex((i) => i - 1);
  }

  // Swipe horizontal pour la lightbox des photos de prépa
  function onPrepSwipeEnd(e: React.TouchEvent) {
    if (prepZoomIndex === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0 && prepZoomIndex < prepPhotos.length - 1) setPrepZoomIndex(prepZoomIndex + 1);
    else if (dx > 0 && prepZoomIndex > 0) setPrepZoomIndex(prepZoomIndex - 1);
  }

  function Thumbnails({ size }: { size: string }) {
    // Si beaucoup de slides (>5), on rend scrollable verticalement avec hauteur cappée
    // pour ne pas déborder sous la BottomNav sur PC.
    return (
      <div
        className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto px-1 py-1 [mask-image:linear-gradient(to_bottom,transparent,#000_8%,#000_92%,transparent)]"
      >
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Fiche ${i + 1}`}
            className={`${size} aspect-square shrink-0 rounded-xl bg-cover bg-center shadow-sm transition ${
              i === index ? 'ring-2 ring-coral ring-offset-2 ring-offset-blush' : 'opacity-60 hover:opacity-100'
            }`}
            style={{ backgroundImage: `url(${src})` }}
          />
        ))}
      </div>
    );
  }

  // Contenu commentaires extrait pour pouvoir être rendu 2 fois :
  // - une fois en mobile (flow normal, juste après les autres sections)
  // - une fois en desktop (absolute, ancré au bas de l'image principale)
  const commentsContent = (
    <>
      {/* Titre caché sur mobile, visible desktop */}
      <h3 className="mb-3 hidden font-script text-2xl text-coral lg:block">Commentaires</h3>

      {/* Bandeau "Réponse à X" — annulable */}
      {replyTo && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-coral-soft/50 px-3 py-1.5 text-xs">
          <span className="truncate text-coral-dark">
            Réponse à <span className="font-bold">{replyTo.author}</span>
          </span>
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            aria-label="Annuler la réponse"
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-coral-dark transition hover:bg-coral hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <form onSubmit={addComment} className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={replyTo ? `Répondre à ${replyTo.author}…` : 'Laissez votre avis…'}
            className="min-w-0 flex-1 rounded-full border border-coral-soft/60 bg-white px-3 py-2 text-sm outline-none placeholder:text-ink-soft focus:border-coral"
          />
          <label
            className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full bg-white text-coral shadow-sm ring-1 ring-coral-soft/60 transition hover:bg-coral-soft/40"
            aria-label="Ajouter une photo"
            title="Ajouter une photo (max 2)"
          >
            <Camera className="h-4 w-4" />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const newFiles = Array.from(e.target.files ?? []) as File[];
                setDraftPhotos((prev) => [...prev, ...newFiles].slice(0, 2));
                e.target.value = '';
              }}
            />
          </label>
          <button
            type="submit"
            aria-label="Envoyer"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral text-white transition hover:bg-coral-dark"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        {draftPhotos.length > 0 && (
          <div className="flex gap-2">
            {draftPhotos.map((f, i) => (
              <span key={i} className="relative block h-14 w-14">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={URL.createObjectURL(f)}
                  alt=""
                  className="h-full w-full rounded-lg object-cover shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => setDraftPhotos((p) => p.filter((_, j) => j !== i))}
                  aria-label="Retirer la photo"
                  className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-white text-coral shadow-sm ring-1 ring-coral-soft hover:bg-coral hover:text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </form>

      <InstaComments
        comments={comments.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          author: c.author,
          text: c.text,
          photos: c.photos,
          likesCount: c.likesCount,
          parentAuthor: c.parentAuthor,
        }))}
        onLike={(id) => likeComment(id)}
        onReply={(ec) => {
          const target = comments.find((c) => c.id === ec.id);
          if (target) setReplyTo(target);
        }}
        onPhotoZoom={(src) => window.open(src, '_blank', 'noopener')}
        maxHeight="50vh"
      />
    </>
  );

  return (
    <>
    {/* ============== VUE IMPRESSION : 1 page par image (cover + slides) ============== */}
    <div className="hidden print:block">
      {images.map((src, i) => (
        <div
          key={src}
          className={`print-page ${i === images.length - 1 ? 'print-page-last' : ''}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`${title} — ${i + 1}/${images.length}`} />
        </div>
      ))}
    </div>

    {/* ============== VUE ÉCRAN ============== */}
    <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-8 print:hidden">
      {/* Fiche + actions, centré dans le viewport — relative pour ancrer les asides */}
      <div className="relative flex items-center justify-center lg:flex-1">
        <div className="flex flex-col items-center gap-4">
          <div className="relative mx-auto aspect-square w-[min(55vh,92vw)] max-w-md lg:w-[26rem] xl:w-[30rem]">
            {/* Feu d'artifice de saison au montage */}
            <FireworkBurst category={category} />
            {/* Vignettes à gauche (desktop) */}
            <div className="absolute right-full top-1/2 mr-10 hidden -translate-y-1/2 lg:block">
              <Thumbnails size="w-16" />
            </div>

            {/* Fiche : hover surélevé, clic → zoom, fondu doux, swipe → navigation */}
            <button
              type="button"
              onClick={() => setZoom(true)}
              onTouchStart={onSwipeStart}
              onTouchEnd={onSwipeEnd}
              aria-label="Agrandir la fiche"
              className="group relative block h-full w-full touch-pan-y transition duration-300 hover:-translate-y-1.5"
            >
              {images.map((src, i) => (
                <span
                  key={src}
                  aria-hidden
                  className={`absolute inset-0 rounded-[var(--radius-card)] bg-cover bg-center shadow-xl transition-opacity duration-500 ease-in-out group-hover:shadow-2xl ${
                    i === index ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                  style={{ backgroundImage: `url(${src})` }}
                />
              ))}
            </button>

            {/* Épingle "Légumes de saison" : UNIQUEMENT sur la main image (slide 0) */}
            {isSeasonal && index === 0 && (
              <div className="pointer-events-none absolute -left-2 -top-3 z-20 lg:-left-4 lg:-top-4">
                <SeasonChip variant="pin" />
              </div>
            )}

            {/* Temps de préparation + cuisson (UNIQUEMENT sur la main image, slide 0) */}
            {index === 0 && (prepTimeMin || cookTimeMin) && (
              <div className="pointer-events-none absolute right-2 top-2 z-20 flex flex-col gap-1">
                {prepTimeMin != null && (
                  <span className="flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-coral-dark shadow-sm">
                    <Clock className="h-3.5 w-3.5" />
                    {prepTimeMin} min
                  </span>
                )}
                {cookTimeMin != null && (
                  <span className="flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-xs font-semibold text-coral-dark shadow-sm">
                    <CookingPot className="h-3.5 w-3.5" />
                    {cookTimeMin} min
                  </span>
                )}
              </div>
            )}

            {/* Points (mobile) */}
            <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5 lg:hidden">
              {images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Aller à la fiche ${i + 1}`}
                  className={`h-2 rounded-full transition ${i === index ? 'w-5 bg-coral' : 'w-2 bg-coral/30'}`}
                />
              ))}
            </div>
          </div>

          {/* Actions centrées sous la fiche + flèches de navigation aux extrémités */}
          <div className="flex items-center justify-center gap-3">
            {!isFirst ? (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                aria-label="Fiche précédente"
                className="grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden className="h-10 w-10" />
            )}
            <button
              type="button"
              onClick={handleShare}
              aria-label="Partager"
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
            >
              <Share2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimer"
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
            >
              <Printer className="h-5 w-5" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={toggleLike}
                aria-pressed={liked}
                aria-label={liked ? 'Je n’aime plus' : 'J’aime'}
                className="flex items-center gap-1.5 rounded-full bg-white py-1 pl-1 pr-3 shadow-sm transition hover:scale-105"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full">
                  <Heart className={`h-5 w-5 animate-heartbeat ${liked ? 'fill-coral text-coral' : 'text-coral'}`} />
                </span>
                <span className="text-sm font-semibold text-coral-dark">{likes}</span>
              </button>
              {/* Cœurs flottants au tap */}
              {floatingHearts.map((id) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={id}
                  src="/images/effects/coeur.png"
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="floating-heart pointer-events-none absolute left-2 top-0 h-8 w-auto select-none"
                />
              ))}
            </div>
            {!isLast ? (
              <button
                type="button"
                onClick={() => setIndex((i) => i + 1)}
                aria-label="Fiche suivante"
                className="grid h-10 w-10 place-items-center rounded-full bg-white text-coral shadow-sm transition hover:scale-110 hover:bg-coral-soft/40"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden className="h-10 w-10" />
            )}
          </div>
        </div>

        {/* Aside Vous aimerez aussi (desktop, ancré au haut de l'image) */}
        {suggestions.length > 0 && (
          <aside className="hidden md:absolute md:left-4 md:top-[calc(50%-13rem)] md:block md:w-28 lg:w-32 xl:top-[calc(50%-15rem)]">
            <h3 className="mb-3 text-center font-script text-2xl text-coral">Vous aimerez aussi</h3>
            <div className="h-[22rem] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_4%,#000_96%,transparent)] xl:h-[26rem]">
              <div className="animate-vscroll flex flex-col gap-3">
                {[...suggestions, ...suggestions].map((r, i) => (
                  <Link key={`${r.id}-${i}`} href={`/recettes/${r.id}`} className="block">
                    <span
                      aria-hidden
                      className="block aspect-square w-full rounded-xl bg-cover bg-center shadow-sm transition hover:scale-105"
                      style={{ backgroundImage: `url(${r.coverImage})` }}
                    />
                    <p className="mt-1 truncate text-center text-xs font-semibold text-ink">{r.title}</p>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* Aside Commentaires (desktop, ancré au bas de l'image — bas aside = bas image) */}
        <aside
          className="hidden lg:absolute lg:right-4 lg:flex lg:w-72 lg:flex-col lg:overflow-y-auto lg:rounded-[var(--radius-card)] lg:border lg:border-coral-soft/40 lg:bg-white/85 lg:p-4 lg:shadow-sm lg:backdrop-blur"
          style={{ bottom: 'calc(50% - 13rem)', maxHeight: '26rem' }}
        >
          {commentsContent}
        </aside>
      </div>

      {/* Mobile : vignettes des slides de la recette (parcours rapide via tap) */}
      {images.length > 1 && (
        <section className="md:hidden">
          <h3 className="mb-2 font-script text-3xl text-coral">Toutes les fiches</h3>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
            {images.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Aller à la fiche ${i + 1}`}
                className={`block w-20 shrink-0 transition hover:-translate-y-0.5 ${
                  i === index ? '' : 'opacity-70'
                }`}
              >
                <span
                  aria-hidden
                  className={`block aspect-square w-full rounded-lg bg-cover bg-center shadow-sm ${
                    i === index ? 'ring-2 ring-coral ring-offset-2 ring-offset-blush' : ''
                  }`}
                  style={{ backgroundImage: `url(${src})` }}
                />
                <p className="mt-1 text-center text-[0.65rem] font-semibold text-coral-dark">
                  {i + 1}/{images.length}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Pellicule "En vrai dans la cuisine" — juste après les vignettes slides */}
      {prepPhotos.length > 0 && (
        <section className="mt-2 lg:mx-auto lg:mt-0 lg:max-w-5xl">
          <h3 className="mb-2 font-script text-3xl text-coral lg:text-center">En vrai dans la cuisine</h3>
          <div className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:gap-3 lg:px-0">
            {prepPhotos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setPrepZoomIndex(i)}
                aria-label={`Agrandir la photo ${i + 1}`}
                className="block w-32 shrink-0 snap-start transition hover:-translate-y-0.5 sm:w-36 lg:w-44"
              >
                <span
                  aria-hidden
                  className="block aspect-square w-full rounded-xl bg-cover bg-center shadow-sm ring-1 ring-coral-soft/40"
                  style={{ backgroundImage: `url(${src})` }}
                />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Mobile : suggestions de recettes (placées après la pellicule) */}
      {suggestions.length > 0 && (
        <section className="md:hidden">
          <h3 className="mb-2 font-script text-3xl text-coral">Vous aimerez aussi</h3>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
            {suggestions.map((r) => (
              <Link key={r.id} href={`/recettes/${r.id}`} className="w-20 shrink-0">
                <span
                  aria-hidden
                  className="block aspect-square w-full rounded-lg bg-cover bg-center shadow-sm"
                  style={{ backgroundImage: `url(${r.coverImage})` }}
                />
                <p className="mt-1 truncate text-center text-[0.65rem] font-semibold text-ink">
                  {r.title}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Commentaires — mobile only (en flow normal) */}
      <aside className="flex w-full flex-col rounded-[var(--radius-card)] border border-coral-soft/40 bg-white/85 p-4 shadow-sm backdrop-blur lg:hidden">
        {commentsContent}
      </aside>

      {/* Zoom plein écran : image en plein écran (object-contain), pinch-to-zoom
          peut s'étendre sur TOUTE la surface visible. Contrôles flottants
          par-dessus (X, flèches, vignettes desktop). Anim douce à l'ouverture. */}
      {zoom && (
        <div
          className="ie-lightbox-in fixed inset-0 z-50 bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          {/* ZoomableImage occupe TOUT l'overlay. Swipe horizontal au
              scale=1 = nav inter-fiche. Au scale>1 = pan en zoom. */}
          <div className="ie-lightbox-content-in absolute inset-0">
            <ZoomableImage
              src={images[index]}
              alt={`${title} — fiche ${index + 1}/${images.length}`}
              className="absolute inset-0 px-4 pb-20 pt-16 sm:px-8"
              imgClassName="max-h-full max-w-full"
              onSwipeLeft={!isLast ? () => setIndex((i) => i + 1) : undefined}
              onSwipeRight={!isFirst ? () => setIndex((i) => i - 1) : undefined}
            />
          </div>

          {/* Vignettes desktop — overlay top-left au-dessus de l'image */}
          <div className="pointer-events-none absolute inset-y-0 left-0 hidden items-center pl-4 sm:flex">
            <div className="pointer-events-auto rounded-2xl bg-black/30 p-2 backdrop-blur-sm">
              <Thumbnails size="w-16 lg:w-20" />
            </div>
          </div>

          {/* Flèches nav — bottom-center, dans la marge basse */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-4">
            {!isFirst ? (
              <button
                type="button"
                onClick={() => setIndex((i) => i - 1)}
                aria-label="Fiche précédente"
                className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105"
              >
                <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden className="h-12 w-12" />
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={() => setIndex((i) => i + 1)}
                aria-label="Fiche suivante"
                className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105"
              >
                <ChevronRight className="h-6 w-6" strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden className="h-12 w-12" />
            )}
          </div>

          {/* Bouton fermer — top-right, dans la marge haute, bien contrasté */}
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setZoom(false)}
            className="absolute right-4 top-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30 transition hover:scale-105"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Lightbox des photos de préparation : navigation flèches + swipe + close */}
      {prepZoomIndex !== null && prepPhotos[prepZoomIndex] && (
        <div
          className="ie-lightbox-in fixed inset-0 z-50 bg-black/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Photo de préparation agrandie"
        >
          {/* Image avec marges + swipe au scale=1 pour navigation photos. */}
          <div className="ie-lightbox-content-in absolute inset-0">
            <ZoomableImage
              src={prepPhotos[prepZoomIndex]}
              alt={`Photo de préparation ${prepZoomIndex + 1}`}
              className="absolute inset-0 px-4 pb-20 pt-16 sm:px-8"
              imgClassName="max-h-full max-w-full"
              onSwipeLeft={
                prepZoomIndex < prepPhotos.length - 1
                  ? () => setPrepZoomIndex(prepZoomIndex + 1)
                  : undefined
              }
              onSwipeRight={
                prepZoomIndex > 0
                  ? () => setPrepZoomIndex(prepZoomIndex - 1)
                  : undefined
              }
            />
          </div>

          {/* Compteur — top-left dans la marge haute */}
          <span className="absolute left-4 top-5 z-20 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-ink shadow-sm ring-2 ring-white/30">
            {prepZoomIndex + 1} / {prepPhotos.length}
          </span>

          {/* Flèches navigation — bottom-center dans la marge basse */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-4">
            {prepZoomIndex > 0 ? (
              <button
                type="button"
                onClick={() => setPrepZoomIndex(prepZoomIndex - 1)}
                aria-label="Photo précédente"
                className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105"
              >
                <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden className="h-12 w-12" />
            )}
            {prepZoomIndex < prepPhotos.length - 1 ? (
              <button
                type="button"
                onClick={() => setPrepZoomIndex(prepZoomIndex + 1)}
                aria-label="Photo suivante"
                className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full bg-white text-coral shadow-lg ring-2 ring-white/30 transition hover:scale-105"
              >
                <ChevronRight className="h-6 w-6" strokeWidth={2.5} />
              </button>
            ) : (
              <span aria-hidden className="h-12 w-12" />
            )}
          </div>

          {/* Bouton fermer — top-right, bien contrasté et accessible */}
          <button
            type="button"
            aria-label="Fermer"
            onClick={() => setPrepZoomIndex(null)}
            className="absolute right-4 top-4 z-20 grid h-11 w-11 place-items-center rounded-full bg-white text-ink shadow-lg ring-2 ring-white/30 transition hover:scale-105"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      )}

      {/* Animation cœur flottant (déclenchée au tap sur le like) */}
      <style>{`
        @keyframes float-heart {
          0%   { transform: translate(-50%, 10px) scale(0.5); opacity: 0; }
          15%  { transform: translate(-50%, -6px) scale(1.25); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translate(-50%, -90px) scale(0.95); opacity: 0; }
        }
        .floating-heart {
          animation: float-heart 1.1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .floating-heart { animation: none; opacity: 0; }
        }
        /* Vue impression : 1 page par slide, image en pleine page centrée */
        @media print {
          @page { margin: 0.5cm; size: auto; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .print-page {
            width: 100vw;
            height: 100vh;
            margin: 0;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            page-break-after: always;
            break-after: page;
            overflow: hidden;
          }
          .print-page-last {
            page-break-after: auto;
            break-after: auto;
          }
          .print-page img {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
          }
        }
      `}</style>
    </div>
    </>
  );
}
