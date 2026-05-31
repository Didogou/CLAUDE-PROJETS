import 'server-only';
import fs from 'node:fs';
import path from 'node:path';

export type DiscoveredPage = {
  /** URL canonique (ex. /recettes/salades, /recettes/[id]). */
  path: string;
  /** Label par défaut généré depuis le chemin (ex. "Recettes › Salades"). */
  defaultLabel: string;
  /** True si la route est dynamique (contient un segment [param]). */
  dynamic: boolean;
};

const APP_DIR = path.join(process.cwd(), 'src', 'app');

// Préfixes / patterns qu'on n'expose PAS dans le tableau de permissions :
// - /admin/* : protégé par le layout admin, pas un sujet utilisateur
// - /api/*   : routes serveur, auth gérée côté route
// - /login, /admin/login, /auth/* : pages d'authentification (anti-loop)
function isExposable(routePath: string): boolean {
  if (routePath.startsWith('/admin')) return false;
  if (routePath.startsWith('/api')) return false;
  if (routePath === '/login') return false;
  if (routePath.startsWith('/auth/')) return false;
  return true;
}

/**
 * Scanne récursivement src/app et retourne toutes les routes contenant
 * un page.tsx. Skip :
 *  - les groupes de routes (entourés de parenthèses) — ils n'affectent pas l'URL
 *  - les répertoires commençant par _ ou .
 *  - api/, login, auth, admin (vérification dans isExposable)
 */
export function discoverPages(): DiscoveredPage[] {
  const pages: DiscoveredPage[] = [];
  walk(APP_DIR, '', pages);
  // Trie : racine d'abord, puis ordre alphabétique
  return pages.sort((a, b) => {
    if (a.path === '/') return -1;
    if (b.path === '/') return 1;
    return a.path.localeCompare(b.path);
  });
}

function walk(dir: string, currentPath: string, out: DiscoveredPage[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Si ce dossier contient un page.tsx → on l'ajoute
  if (entries.some((e) => e.isFile() && (e.name === 'page.tsx' || e.name === 'page.ts'))) {
    const routePath = currentPath || '/';
    if (isExposable(routePath)) {
      out.push({
        path: routePath,
        defaultLabel: humanizePath(routePath),
        dynamic: routePath.includes('['),
      });
    }
  }

  // Descend dans les sous-dossiers
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.startsWith('_') || name.startsWith('.')) continue;

    // Groupe de routes (parenthèses) → n'apparaît pas dans l'URL
    const isGroup = name.startsWith('(') && name.endsWith(')');
    const nextPath = isGroup ? currentPath : `${currentPath}/${name}`;

    walk(path.join(dir, name), nextPath, out);
  }
}

/**
 * Génère un label lisible depuis un chemin URL.
 * "/recettes/salades" → "Recettes › Salades"
 * "/recettes/[id]"    → "Recettes › Détail"
 * "/"                 → "Accueil"
 */
function humanizePath(p: string): string {
  if (p === '/') return 'Accueil';
  const segments = p.split('/').filter(Boolean);
  return segments
    .map((seg) => {
      if (seg.startsWith('[') && seg.endsWith(']')) return 'Détail';
      return seg
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
    })
    .join(' › ');
}
