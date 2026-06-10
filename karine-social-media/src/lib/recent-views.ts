'use client';

/**
 * Historique local des contenus visités (recettes, astuces, conseils, menus).
 * Stocké en localStorage par utilisatrice (clé fixe — pas besoin de DB).
 * Limité aux 20 derniers items, dédupliqué par (type, id).
 */

const KEY = 'karine.recent-views.v1';
const MAX = 20;

export type RecentViewType = 'recipe' | 'menu' | 'tip' | 'advice';

export type RecentView = {
  type: RecentViewType;
  id: string;
  label: string;
  imageUrl: string | null;
  href: string;
  viewedAt: string;
};

export function trackView(item: Omit<RecentView, 'viewedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const now = new Date().toISOString();
    const next: RecentView = { ...item, viewedAt: now };
    const raw = localStorage.getItem(KEY);
    const prev: RecentView[] = raw ? JSON.parse(raw) : [];
    // Dédup : retire l'item s'il était déjà dans la liste
    const cleaned = prev.filter(
      (x) => !(x.type === item.type && x.id === item.id),
    );
    cleaned.unshift(next);
    const trimmed = cleaned.slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* localStorage indisponible (mode privé etc.) */
  }
}

export function getRecentViews(): RecentView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentView[];
  } catch {
    return [];
  }
}

export function clearRecentViews(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** Retire un item spécifique de l'historique (ex. image cassée =
 *  cible probablement supprimée). */
export function removeRecentView(type: RecentViewType, id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const prev: RecentView[] = JSON.parse(raw);
    const next = prev.filter((x) => !(x.type === type && x.id === id));
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage indisponible */
  }
}
