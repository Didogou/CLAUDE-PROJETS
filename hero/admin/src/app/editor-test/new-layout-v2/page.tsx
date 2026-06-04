/**
 * Wrapper Server Component pour la route /editor-test/new-layout-v2.
 *
 * Pourquoi ce wrapper ?
 *   - PageClient.tsx est un Client Component qui utilise
 *     useSearchParams() ; sans Suspense / sans force-dynamic, le
 *     build Next.js (>= 14) echoue au prerender statique (cf erreur
 *     Vercel 2026-06-04 : "useSearchParams should be wrapped in a
 *     suspense boundary").
 *   - `export const dynamic = 'force-dynamic'` n est pas autorise
 *     dans un fichier 'use client'. On l isole donc dans ce wrapper
 *     Server.
 *   - PageClient n est PAS detecte comme route par Next (nom
 *     different de "page.tsx") -> pas de double build.
 */
export const dynamic = 'force-dynamic'

export { default } from './PageClient'
