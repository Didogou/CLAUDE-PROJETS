/**
 * Rate-limit in-memory (par instance serverless).
 *
 * Volontairement minimaliste : pas d'Upstash/Redis, on utilise la
 * memory de l'instance. Vercel partage les instances entre quelques
 * fonctions chaudes : la limite est "douce" mais elle stoppe un
 * burst depuis un meme IP sur quelques secondes, ce qui suffit
 * largement pour les usages LLM payants (1-2 req/min legitime).
 *
 * Pour passer en mode strict cross-instances → switch vers
 * @upstash/ratelimit + @upstash/redis. Garder la meme signature.
 *
 * Usage :
 *   const r = await checkRateLimit({ req, key: 'mistral', windowMs: 60_000, max: 5 })
 *   if (!r.ok) return NextResponse.json({ error: r.error }, { status: 429 })
 */

import type { NextRequest } from 'next/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Hit = { count: number; resetAt: number };
const buckets = new Map<string, Hit>();
const MAX_KEYS = 5000; // cap RAM (pas d'auto-purge agressive)

function getIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; error: string; retryAfter: number };

export function checkRateLimit(opts: {
  req: NextRequest;
  /** Identifiant logique de l'endpoint (ex: "mistral", "vision"). */
  key: string;
  /** Fenetre de comptage en ms (ex: 60_000 = 1 min). */
  windowMs: number;
  /** Nombre de hits max dans la fenetre. */
  max: number;
  /** Cle additionnelle (ex: user.id) si on veut limiter par user. */
  scope?: string;
}): RateLimitResult {
  const ip = getIp(opts.req);
  const id = `${opts.key}:${opts.scope ?? ''}:${ip}`;
  const now = Date.now();
  const hit = buckets.get(id);
  if (!hit || hit.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + opts.windowMs });
    // Purge opportuniste si on depasse le cap memoire
    if (buckets.size > MAX_KEYS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
        if (buckets.size <= MAX_KEYS * 0.8) break;
      }
    }
    return { ok: true, remaining: opts.max - 1 };
  }
  if (hit.count >= opts.max) {
    return {
      ok: false,
      error: 'Trop de requêtes. Patiente quelques secondes.',
      retryAfter: Math.max(1, Math.ceil((hit.resetAt - now) / 1000)),
    };
  }
  hit.count++;
  return { ok: true, remaining: opts.max - hit.count };
}
