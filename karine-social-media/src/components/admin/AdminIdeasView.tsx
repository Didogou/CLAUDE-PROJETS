'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ChefHat, HelpCircle, Lightbulb, X } from 'lucide-react';
import type { IdeaType, IdeaWithAuthor } from '@/data/ideas';

const TYPE_META: Record<
  IdeaType,
  { label: string; icon: typeof Lightbulb; tint: string }
> = {
  recette: { label: 'Recette', icon: ChefHat, tint: 'bg-coral-soft/40 text-coral-dark' },
  astuce: { label: 'Astuce', icon: Lightbulb, tint: 'bg-tangerine/15 text-tangerine' },
  question: { label: 'Question', icon: HelpCircle, tint: 'bg-sage/15 text-sage' },
};

function formatDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Tab = 'nouvelles' | 'repondues';

export function AdminIdeasView({
  nouvelles,
  repondues,
}: {
  nouvelles: IdeaWithAuthor[];
  repondues: IdeaWithAuthor[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('nouvelles');
  const [openIdea, setOpenIdea] = useState<IdeaWithAuthor | null>(null);

  const list = tab === 'nouvelles' ? nouvelles : repondues;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-full bg-admin-surface p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setTab('nouvelles')}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === 'nouvelles'
              ? 'bg-admin-primary text-white shadow-sm'
              : 'text-admin-ink-soft hover:bg-admin-primary/10'
          }`}
        >
          Nouvelles ({nouvelles.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('repondues')}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
            tab === 'repondues'
              ? 'bg-admin-primary text-white shadow-sm'
              : 'text-admin-ink-soft hover:bg-admin-primary/10'
          }`}
        >
          Répondues ({repondues.length})
        </button>
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-admin-primary/30 bg-white px-6 py-12 text-center text-admin-ink-soft">
          {tab === 'nouvelles'
            ? 'Aucune idée en attente. Tu seras notifiée par email à chaque nouvelle soumission.'
            : 'Aucune idée répondue pour l’instant.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((idea) => {
            const meta = TYPE_META[idea.type];
            const Icon = meta.icon;
            return (
              <li key={idea.id}>
                <button
                  type="button"
                  onClick={() => setOpenIdea(idea)}
                  className="w-full rounded-2xl bg-white p-4 text-left shadow-sm transition hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${meta.tint}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-admin-primary/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-admin-primary-dark">
                          {meta.label}
                        </span>
                        <span className="text-[0.7rem] text-admin-ink-soft">
                          {formatDateFr(idea.createdAt)}
                        </span>
                      </div>
                      <p className="truncate text-base font-semibold text-admin-ink">
                        {idea.title}
                      </p>
                      <p className="text-xs text-admin-ink-soft">
                        De {idea.authorName ?? idea.authorEmail ?? 'inconnue'}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {openIdea && (
        <ReplyModal
          idea={openIdea}
          onClose={() => setOpenIdea(null)}
          onSent={() => {
            setOpenIdea(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ReplyModal({
  idea,
  onClose,
  onSent,
}: {
  idea: IdeaWithAuthor;
  onClose: () => void;
  onSent: () => void;
}) {
  const [reply, setReply] = useState(idea.reply ?? '');
  const readOnly = idea.status === 'replied';
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const meta = TYPE_META[idea.type];

  async function send() {
    if (readOnly || status === 'sending') return;
    if (!reply.trim()) {
      setStatus('error');
      setErrorMsg('Une réponse vide ne peut pas être envoyée.');
      return;
    }
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await fetch(`/api/admin/ideas/${idea.id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reply: reply.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('error');
        setErrorMsg(json?.error ?? 'Erreur inconnue');
        return;
      }
      onSent();
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Erreur réseau');
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 pt-12 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reply-idea-title"
    >
      <div className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-admin-primary/15 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-admin-primary-dark">
              {meta.label}
            </p>
            <h2
              id="reply-idea-title"
              className="truncate text-base font-semibold text-admin-ink"
            >
              {idea.title}
            </h2>
            <p className="text-xs text-admin-ink-soft">
              De {idea.authorName ?? idea.authorEmail ?? 'inconnue'} —{' '}
              {formatDateFr(idea.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-admin-primary/10 text-admin-primary-dark transition hover:bg-admin-primary/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <section>
            <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
              Message
            </p>
            <div className="whitespace-pre-wrap rounded-xl border border-admin-primary/15 bg-admin-surface/60 px-3 py-2 text-sm text-admin-ink">
              {idea.body}
            </div>
          </section>

          <section>
            <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-admin-ink-soft">
              {readOnly ? 'Ta réponse' : 'Réponse à envoyer'}
            </p>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              readOnly={readOnly}
              rows={6}
              maxLength={4000}
              placeholder="Donne une réponse claire, encourageante et actionnable…"
              className={`w-full resize-none rounded-xl border border-admin-primary/30 px-3 py-2 text-sm shadow-sm focus:border-admin-primary focus:outline-none focus:ring-2 focus:ring-admin-primary/30 ${
                readOnly ? 'cursor-not-allowed bg-admin-surface/40 text-admin-ink-soft' : 'bg-white text-admin-ink'
              }`}
            />
            {!readOnly && (
              <p className="mt-1 text-right text-[0.65rem] text-admin-ink-soft">
                {reply.length} / 4000
              </p>
            )}
          </section>

          {readOnly && idea.repliedAt && (
            <p className="text-xs text-admin-ink-soft">
              Envoyée le {formatDateFr(idea.repliedAt)}.
            </p>
          )}

          {status === 'error' && (
            <p className="rounded-lg bg-admin-primary/15 px-3 py-2 text-xs font-semibold text-admin-primary-dark">
              {errorMsg}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-admin-primary/30 bg-white px-4 py-2 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-primary/10"
            >
              {readOnly ? 'Fermer' : 'Annuler'}
            </button>
            {!readOnly && (
              <button
                type="button"
                onClick={send}
                disabled={status === 'sending'}
                className="rounded-full bg-admin-primary px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-60"
              >
                {status === 'sending' ? 'Envoi…' : 'Envoyer la réponse'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
