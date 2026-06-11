'use client';

import { useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { DEFAULT_ABOUT_PAGE_CONTENT } from '@/data/app-settings';

/**
 * Éditeur de contenu de la page /a-propos (admin).
 *
 * Markdown très léger :
 *   #   titre
 *   ##  sous-titre
 *   ### sur-sous-titre
 *   ligne vide = nouveau paragraphe
 *
 * Persisté dans app_settings.about_page_content via
 * PATCH /api/admin/settings/about-page.
 */
export function AboutPageEditor({ initial }: { initial: string }) {
  // Si la colonne DB est vide ou la migration pas appliquée, on
  // pré-remplit avec le DEFAULT pour que l'admin voie ce que la
  // page publique affiche (au lieu d'un textarea vide trompeur).
  const [value, setValue] = useState(
    initial && initial.trim().length > 0 ? initial : DEFAULT_ABOUT_PAGE_CONTENT,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/settings/about-page', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aboutPageContent: value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur de sauvegarde');
      setSavedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl bg-admin-surface p-4 shadow-sm ring-1 ring-admin-border">
      <header>
        <h3 className="text-sm font-bold text-admin-ink">Page À propos</h3>
        <p className="mt-0.5 text-xs text-admin-ink-soft">
          Texte affiché sur <code>/a-propos</code>. Markdown léger : <code>#</code>{' '}
          titre, <code>##</code> sous-titre, <code>###</code> sur-sous-titre, ligne vide
          = nouveau paragraphe.
        </p>
      </header>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={16}
        spellCheck
        className="w-full rounded-xl border border-admin-border bg-white px-3 py-2 font-mono text-sm leading-relaxed text-admin-ink focus:border-admin-primary focus:outline-none"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.65rem] text-admin-ink-soft">
          {value.length} caractère{value.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          {savedAt !== null && Date.now() - savedAt < 3000 && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <Check className="size-3" /> Enregistré
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-admin-primary px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Sauvegarder
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      )}
    </section>
  );
}
