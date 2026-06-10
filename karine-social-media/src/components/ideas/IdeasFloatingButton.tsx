'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChefHat, HelpCircle, Lightbulb, Sparkles, X } from 'lucide-react';
import type { IdeaType } from '@/data/ideas';

/**
 * Bouton flottant "Idées" visible sur toutes les pages user (sauf admin).
 * Au clic : modale sticky 3 types (recette / astuce / question) + champ
 * titre + champ libre. Envoi vers /api/ideas.
 *
 * Sticky = la modale ne se ferme PAS au clic backdrop ni Escape. Seul le X
 * en haut à droite ou le bouton Annuler la ferment (conformément à la règle
 * "modales sticky" établie par Didier pour les flows importants).
 */

type Status = 'idle' | 'sending' | 'sent' | 'error';

const TYPES: {
  value: IdeaType;
  label: string;
  icon: typeof Lightbulb;
  hint: string;
}[] = [
  {
    value: 'recette',
    label: 'Recette',
    icon: ChefHat,
    hint: 'Une recette que tu aimerais voir adaptée par Karine',
  },
  {
    value: 'astuce',
    label: 'Astuce',
    icon: Lightbulb,
    hint: 'Une astuce diététique du quotidien que tu aimerais partager',
  },
  {
    value: 'question',
    label: 'Question',
    icon: HelpCircle,
    hint: 'Une question à poser à Karine',
  },
];

export function IdeasFloatingButton({
  variant = 'pill',
}: {
  /** Forme du bouton trigger.
   *  - 'pill'        : pastille blanche "💡 Une idée ?" inline (header legacy).
   *  - 'fab'         : bouton rond flottant en bas-droite (fixed).
   *  - 'inline-small': bouton rond en flow normal (pas fixed),
   *                    taille reduite h-10 w-10. Utilise dans la
   *                    BottomNav home pour s'aligner avec le FAB camera. */
  variant?: 'pill' | 'fab' | 'inline-small';
} = {}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IdeaType>('recette');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Lock body scroll quand modal ouvert
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function reset() {
    setType('recette');
    setTitle('');
    setBody('');
    setStatus('idle');
    setErrorMsg('');
  }

  function close() {
    setOpen(false);
    // Reset après animation
    setTimeout(reset, 200);
  }

  async function submit() {
    if (status === 'sending') return;
    if (!title.trim() || !body.trim()) {
      setErrorMsg('Donne un titre et un message court.');
      setStatus('error');
      return;
    }
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          body: body.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json?.error ?? 'Erreur inconnue');
        setStatus('error');
        return;
      }
      setStatus('sent');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur réseau');
      setStatus('error');
    }
  }

  return (
    <>
      {variant === 'fab' ? (
        /* FAB rond flottant : ancré bottom-right au-dessus de la
           BottomNav (qui fait ~4rem + safe-area). Toujours visible
           même au scroll. Pattern Material Action Button.
           bottom-20 = 5rem = au-dessus de la BottomNav fixed. */
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Soumettre une idée à Karine"
          className="fixed bottom-20 right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-white text-amber-400 shadow-lg ring-2 ring-coral-soft transition hover:scale-110 active:scale-95"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <Lightbulb className="h-5 w-5 fill-amber-400" strokeWidth={2.2} />
        </button>
      ) : variant === 'inline-small' ? (
        /* Variante INLINE-SMALL : bouton rond en flow (pas fixed),
           h-10 w-10, integre dans la BottomNav home a cote du FAB
           camera. Ouvre la meme modal. */
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Soumettre une idée à Karine"
          className="grid h-10 w-10 place-items-center rounded-full bg-white text-amber-400 shadow-md ring-2 ring-coral-soft transition hover:scale-105 active:scale-95"
        >
          <Lightbulb className="h-6 w-6 fill-amber-400" strokeWidth={2.2} />
        </button>
      ) : (
        /* Pill blanc inline (legacy) — utilisé dans le header. */
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Soumettre une idée à Karine"
          className="group flex items-center gap-1.5 rounded-full bg-white py-1 pl-1 pr-3 shadow-md ring-2 ring-coral-soft/60 transition hover:scale-105 active:scale-95"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-amber-400 shadow-sm ring-1 ring-coral-soft/40">
            <Lightbulb className="h-3.5 w-3.5 fill-amber-400" strokeWidth={2.2} />
          </span>
          <span className="font-script text-base text-coral-dark sm:text-lg">
            Une idée&nbsp;?
          </span>
        </button>
      )}

      {mounted &&
        open &&
        createPortal(
          <div
            className="anim-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 pt-12 backdrop-blur-sm sm:items-center sm:p-6"
            // Sticky : pas de onClick sur le backdrop
            role="dialog"
            aria-modal="true"
            aria-labelledby="ideas-title"
          >
            <div className="anim-slide-up relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-coral-soft/30 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-coral" />
                  <h2
                    id="ideas-title"
                    className="font-semibold text-ink"
                  >
                    Soumettre une idée
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Fermer"
                  className="grid h-8 w-8 place-items-center rounded-full bg-coral-soft/40 text-coral-dark transition hover:bg-coral-soft/60"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {status === 'sent' ? (
                <div className="space-y-3 px-5 py-8 text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-sage/15 text-sage">
                    <Sparkles className="h-7 w-7" />
                  </div>
                  <p className="text-base font-semibold text-ink">
                    Merci pour ton idée !
                  </p>
                  <p className="text-sm text-ink-soft">
                    Karine a reçu ta proposition par email. Tu seras notifiée
                    via la cloche dès qu’elle te répondra.
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    className="mt-2 rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark"
                  >
                    Fermer
                  </button>
                </div>
              ) : (
                <div className="space-y-4 overflow-y-auto px-5 py-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      Type
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {TYPES.map((t) => {
                        const Icon = t.icon;
                        const active = type === t.value;
                        return (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => setType(t.value)}
                            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-semibold transition ${
                              active
                                ? 'border-coral bg-coral-soft/40 text-coral-dark'
                                : 'border-coral-soft/40 bg-white text-ink-soft hover:bg-coral-soft/15'
                            }`}
                          >
                            <Icon className="h-5 w-5" />
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-ink-soft">
                      {TYPES.find((t) => t.value === type)?.hint}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="idea-title"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft"
                    >
                      Titre
                    </label>
                    <input
                      id="idea-title"
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={160}
                      placeholder={
                        type === 'recette'
                          ? 'Ex. Tarte au citron meringuée light'
                          : type === 'astuce'
                            ? 'Ex. Mes graines à toujours avoir'
                            : 'Ex. Comment gérer les fringales du soir ?'
                      }
                      className="w-full rounded-xl border border-coral-soft/40 bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="idea-body"
                      className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft"
                    >
                      Message
                    </label>
                    <textarea
                      id="idea-body"
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      maxLength={4000}
                      rows={5}
                      placeholder="Donne-lui le maximum de contexte (ingrédients, situation, fréquence...)"
                      className="w-full resize-none rounded-xl border border-coral-soft/40 bg-white px-3 py-2 text-sm text-ink shadow-sm focus:border-coral focus:outline-none focus:ring-2 focus:ring-coral/30"
                    />
                    <p className="mt-1 text-right text-[0.65rem] text-ink-soft">
                      {body.length} / 4000
                    </p>
                  </div>

                  {status === 'error' && (
                    <p className="rounded-lg bg-coral-soft/30 px-3 py-2 text-xs font-semibold text-coral-dark">
                      {errorMsg}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-full border border-coral-soft/50 bg-white px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-coral-soft/10"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={status === 'sending'}
                      className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-dark disabled:opacity-60"
                    >
                      {status === 'sending' ? 'Envoi…' : 'Envoyer à Karine'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
