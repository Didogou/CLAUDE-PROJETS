/* eslint-disable @next/next/no-img-element */
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Smartphone, Monitor, Trash2 } from 'lucide-react';
import type { BackgroundVariantKey } from '@/data/background-images';

export type BackgroundRow = {
  key: BackgroundVariantKey;
  label: string;
  description: string;
  fallbackPortrait: string;
  fallbackPaysage: string;
  portraitUrl: string | null;
  paysageUrl: string | null;
};

export function BackgroundsView({ rows }: { rows: BackgroundRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(
    variant: BackgroundVariantKey,
    kind: 'portrait' | 'paysage',
    file: File,
  ) {
    const id = `${variant}-${kind}`;
    setBusy(id);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('variant', variant);
      fd.append('kind', kind);
      fd.append('file', file);
      const res = await fetch('/api/admin/background-images', {
        method: 'POST',
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Upload échoué');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  async function reset(variant: BackgroundVariantKey, kind: 'portrait' | 'paysage') {
    const id = `${variant}-${kind}`;
    if (!window.confirm(`Restaurer le fond ${kind} par défaut pour « ${variant} » ?`)) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/background-images?variant=${variant}&kind=${kind}`,
        { method: 'DELETE' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-admin-primary/20 bg-admin-soft/30 p-4 text-xs text-admin-ink-soft">
        <p>
          <b>Conseil de formats</b> :
        </p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>
            <b>Portrait</b> (mobile) : 1080 × 1920 px environ (ratio 9:16)
          </li>
          <li>
            <b>Paysage</b> (PC) : 1920 × 1080 px environ (ratio 16:9)
          </li>
          <li>Aucune contrainte stricte : l’app adapte automatiquement.</li>
        </ul>
      </div>

      {rows.map((row) => (
        <section
          key={row.key}
          className="overflow-hidden rounded-2xl bg-admin-surface shadow-sm"
        >
          <header className="border-b border-admin-border bg-admin-soft/40 px-4 py-3">
            <h3 className="text-base font-bold text-admin-ink">{row.label}</h3>
            <p className="mt-0.5 text-xs text-admin-ink-soft">{row.description}</p>
          </header>

          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Slot
              icon={<Smartphone className="h-4 w-4" />}
              kindLabel="Portrait (mobile)"
              currentUrl={row.portraitUrl ?? row.fallbackPortrait}
              hasOverride={!!row.portraitUrl}
              isBusy={busy === `${row.key}-portrait`}
              onUpload={(f) => upload(row.key, 'portrait', f)}
              onReset={() => reset(row.key, 'portrait')}
            />
            <Slot
              icon={<Monitor className="h-4 w-4" />}
              kindLabel="Paysage (tablette / PC)"
              currentUrl={row.paysageUrl ?? row.fallbackPaysage}
              hasOverride={!!row.paysageUrl}
              isBusy={busy === `${row.key}-paysage`}
              onUpload={(f) => upload(row.key, 'paysage', f)}
              onReset={() => reset(row.key, 'paysage')}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function Slot({
  icon,
  kindLabel,
  currentUrl,
  hasOverride,
  isBusy,
  onUpload,
  onReset,
}: {
  icon: React.ReactNode;
  kindLabel: string;
  currentUrl: string;
  hasOverride: boolean;
  isBusy: boolean;
  onUpload: (file: File) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-admin-ink">
          {icon}
          {kindLabel}
        </p>
        {hasOverride && (
          <span className="rounded-full bg-coral-soft/40 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-coral-dark">
            Personnalisé
          </span>
        )}
      </div>

      {/* Preview du fond actuel */}
      <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-admin-soft/40 shadow-inner">
        <img
          src={currentUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={isBusy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-admin-primary px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-admin-primary-dark disabled:opacity-50"
        >
          <ImagePlus className="h-3.5 w-3.5" />
          {isBusy ? 'Upload…' : 'Remplacer'}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={onReset}
            disabled={isBusy}
            aria-label="Restaurer par défaut"
            className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <input
          ref={ref}
          type="file"
          accept="image/*"
          disabled={isBusy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.currentTarget.value = '';
          }}
          className="hidden"
        />
      </div>
    </div>
  );
}
