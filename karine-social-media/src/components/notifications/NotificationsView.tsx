'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BellOff,
  CheckCheck,
  HeartHandshake,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import type {
  AppNotification,
  NotificationType,
} from '@/data/notifications';

const TYPE_META: Record<
  NotificationType,
  { label: string; icon: typeof Sparkles; bg: string; color: string }
> = {
  new_post: {
    label: 'Nouveau post',
    icon: Sparkles,
    bg: 'bg-coral-soft/40',
    color: 'text-coral-dark',
  },
  comment_reply: {
    label: 'Réponse à ton commentaire',
    icon: MessageCircle,
    bg: 'bg-sage/15',
    color: 'text-sage',
  },
  idea_reply: {
    label: 'Réponse à ton idée',
    icon: HeartHandshake,
    bg: 'bg-tangerine/15',
    color: 'text-tangerine',
  },
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `il y a ${days} j`;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
  });
}

export function NotificationsView({
  initial,
}: {
  initial: AppNotification[];
}) {
  const router = useRouter();
  const [notifs, setNotifs] = useState(initial);
  const [marking, setMarking] = useState(false);

  async function markAllRead() {
    setMarking(true);
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      if (res.ok) {
        setNotifs((ns) =>
          ns.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
        );
        router.refresh();
      }
    } finally {
      setMarking(false);
    }
  }

  async function markOne(id: number) {
    // Optimiste
    setNotifs((ns) =>
      ns.map((n) =>
        n.id === id
          ? { ...n, isRead: true, readAt: new Date().toISOString() }
          : n,
      ),
    );
    await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
    router.refresh();
  }

  if (notifs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-coral-soft bg-white/80 px-6 py-12 text-center text-ink-soft shadow-sm">
        <BellOff className="mx-auto mb-2 h-8 w-8 text-coral" />
        <p className="text-sm font-semibold text-ink">Aucune notification</p>
        <p className="mt-1 text-xs">
          Quand Karine publiera ou répondra à un de tes commentaires, tu le
          verras ici.
        </p>
      </div>
    );
  }

  const unreadCount = notifs.filter((n) => !n.isRead).length;

  return (
    <div className="space-y-3">
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={markAllRead}
          disabled={marking}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-coral-dark shadow-sm transition hover:bg-coral-soft/30 disabled:opacity-50"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Tout marquer comme lu
        </button>
      )}

      <ul className="space-y-2">
        {notifs.map((n) => {
          const meta = TYPE_META[n.type];
          const Icon = meta.icon;
          const inner = (
            <div
              className={`flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm transition ${
                n.isRead
                  ? 'border-transparent opacity-70'
                  : 'border-coral-soft hover:bg-coral-soft/10'
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${meta.bg} ${meta.color}`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex items-center gap-2">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-ink-soft">
                    {meta.label}
                  </span>
                  {!n.isRead && (
                    <span className="inline-block h-2 w-2 rounded-full bg-coral" />
                  )}
                </p>
                {n.payload.title && (
                  <p className="truncate text-sm font-semibold text-ink">
                    {n.payload.title}
                  </p>
                )}
                {n.payload.body && (
                  <p className="line-clamp-2 text-xs text-ink-soft">
                    {n.payload.body}
                  </p>
                )}
                <p className="text-[0.65rem] text-ink-soft">
                  {formatRelative(n.createdAt)}
                </p>
              </div>
            </div>
          );

          return (
            <li key={n.id}>
              {n.payload.href ? (
                <Link
                  href={n.payload.href}
                  onClick={() => !n.isRead && markOne(n.id)}
                  className="block"
                >
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => !n.isRead && markOne(n.id)}
                  className="block w-full text-left"
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
