/* eslint-disable @next/next/no-img-element */
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MicOff, Search, ShieldCheck, User as UserIcon, VolumeX } from 'lucide-react';
import type { ProfileForModeration } from '@/lib/profiles-admin';

export function ModerationView({ initial }: { initial: ProfileForModeration[] }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initial);
  const [q, setQ] = useState('');
  const [openModal, setOpenModal] = useState<ProfileForModeration | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return profiles;
    return profiles.filter((p) =>
      [p.email, p.fullName].some((v) => v?.toLowerCase().includes(s)),
    );
  }, [profiles, q]);

  async function applyMute(
    p: ProfileForModeration,
    reason: string,
    days: number | null,
  ) {
    setBusyId(p.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/mutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: p.id, reason, days }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Échec');
      setProfiles((arr) =>
        arr.map((x) =>
          x.id === p.id
            ? {
                ...x,
                muted: true,
                mutedUntil:
                  days && days > 0
                    ? new Date(Date.now() + days * 86400_000).toISOString()
                    : null,
                muteReason: reason,
              }
            : x,
        ),
      );
      setOpenModal(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  async function unmute(p: ProfileForModeration) {
    if (!window.confirm(`Lever la modération de ${p.email ?? 'cette utilisatrice'} ?`))
      return;
    setBusyId(p.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mutes?userId=${p.id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Erreur');
      setProfiles((arr) =>
        arr.map((x) =>
          x.id === p.id
            ? { ...x, muted: false, mutedUntil: null, muteReason: null }
            : x,
        ),
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-ink-soft" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher par email ou nom…"
          className="w-full rounded-full border border-admin-primary/30 bg-white py-2 pl-10 pr-3 text-sm text-admin-ink shadow-sm focus:border-admin-primary focus:outline-none"
        />
      </div>

      <ul className="space-y-2">
        {filtered.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 rounded-2xl bg-admin-surface p-3 shadow-sm"
          >
            <Avatar url={p.avatarUrl} fallback={p.fullName ?? p.email ?? '?'} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-admin-ink">
                {p.fullName ?? '(nom non renseigné)'}
              </p>
              <p className="truncate text-xs text-admin-ink-soft">{p.email}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <span className="rounded-full bg-admin-soft px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-admin-ink">
                  {p.role}
                </span>
                {p.muted && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-red-700 ring-1 ring-red-200">
                    <VolumeX className="h-3 w-3" />
                    Mute
                    {p.mutedUntil
                      ? ` jusqu’au ${new Date(p.mutedUntil).toLocaleDateString('fr-FR')}`
                      : ' (permanent)'}
                  </span>
                )}
              </div>
            </div>

            {p.muted ? (
              <button
                type="button"
                onClick={() => unmute(p)}
                disabled={busyId === p.id}
                className="flex items-center gap-1.5 rounded-full bg-sage/15 px-3 py-1.5 text-xs font-bold text-sage transition hover:bg-sage/25 disabled:opacity-50"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Lever
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setOpenModal(p)}
                disabled={busyId === p.id}
                className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-50"
              >
                <MicOff className="h-3.5 w-3.5" />
                Mute
              </button>
            )}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-10 text-center text-admin-ink-soft">
            Aucune utilisatrice
          </li>
        )}
      </ul>

      {openModal && (
        <MuteModal
          profile={openModal}
          onClose={() => setOpenModal(null)}
          onConfirm={applyMute}
        />
      )}
    </div>
  );
}

function Avatar({ url, fallback }: { url: string | null; fallback: string }) {
  const initial = fallback.trim().charAt(0).toUpperCase() || '?';
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-white"
      />
    );
  }
  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-coral-soft/40 text-base font-bold text-coral-dark ring-2 ring-white">
      {initial !== '?' ? initial : <UserIcon className="h-5 w-5" />}
    </span>
  );
}

function MuteModal({
  profile,
  onClose,
  onConfirm,
}: {
  profile: ProfileForModeration;
  onClose: () => void;
  onConfirm: (p: ProfileForModeration, reason: string, days: number | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<'7' | '30' | 'perm'>('7');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 pt-12 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <h3 className="font-bold text-admin-ink">
          Mute {profile.fullName ?? profile.email}
        </h3>
        <p className="mt-1 text-xs text-admin-ink-soft">
          L&apos;utilisatrice perd le droit de liker, commenter, soumettre une idée
          jusqu&apos;à la levée de la modération.
        </p>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">
            Raison (visible côté utilisatrice si tu lui en parles)
          </span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Ex. propos déplacés en commentaires, spam, etc."
            className="w-full resize-none rounded-lg border border-admin-primary/30 bg-white px-3 py-2 text-sm text-admin-ink shadow-sm focus:border-admin-primary focus:outline-none"
          />
        </label>

        <fieldset className="mt-3">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">
            Durée
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {(['7', '30', 'perm'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDuration(d)}
                className={`rounded-xl px-2 py-2 text-xs font-bold transition ${
                  duration === d
                    ? 'bg-admin-primary text-white shadow-sm'
                    : 'bg-admin-soft text-admin-ink hover:bg-admin-soft/80'
                }`}
              >
                {d === '7' ? '7 jours' : d === '30' ? '30 jours' : 'Permanent'}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-admin-border bg-white px-4 py-2 text-sm font-semibold text-admin-ink-soft transition hover:bg-admin-soft/30"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm(
                profile,
                reason.trim(),
                duration === 'perm' ? null : Number(duration),
              )
            }
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-700"
          >
            Mute
          </button>
        </div>
      </div>
    </div>
  );
}
