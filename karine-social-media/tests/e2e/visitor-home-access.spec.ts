import { expect, test } from '@playwright/test';

/**
 * Suite "Accès visiteur — Accueil"
 *
 * Vérifie automatiquement, depuis un contexte SANS cookie, que :
 *   1. Toutes les pages protégées redirigent vers /login?next=<path>
 *   2. La home affiche bien un état "visiteur" (pas de menu admin,
 *      pas d'avatar d'utilisatrice)
 *   3. Les CTA depuis la home (BottomNav, header) routent correctement
 *   4. Le paramètre ?next= est préservé au refresh et utilisé après login
 *   5. Les pages publiques restent accessibles
 *
 * Pendant complémentaire de la checklist manuelle /admin/tests/visitor-home
 * qui couvre les cas UI qu'un test serveur ne peut pas voir (animations,
 * double-clics, contraste, etc.).
 *
 * IMPORTANT : on utilise un browser context vierge (cookies vides)
 * pour chaque test, garanti par le default de Playwright (test isolation).
 */

// --- 1. Pages protégées → redirection /login ---------------------------------

// Pour chaque chemin protégé, on attend EXPLICITEMENT que la nav finale
// pointe sur /login avec un ?next=<original>. Ces routes sont gardées par
// le middleware Supabase (src/lib/supabase/middleware.ts), pas par l'UI.
const PROTECTED_PATHS = [
  '/courses',
  '/courses/historique',
  '/favoris',
  '/mes-calories',
  '/mes-stats',
  '/mes-repas',
  '/profil',
  '/mon-plan',
  '/notifications',
];

test.describe('Visiteur — redirections pages protégées', () => {
  for (const path of PROTECTED_PATHS) {
    test(`GET ${path} sans cookie → /login?next=${path}`, async ({ page }) => {
      // waitUntil 'load' pour que le redirect côté middleware soit suivi
      // jusqu'à la page finale.
      await page.goto(path, { waitUntil: 'load' });
      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      // next= peut être URL-encodé selon la version Next ; on compare la
      // valeur décodée.
      const next = url.searchParams.get('next');
      expect(next, `paramètre next manquant pour ${path}`).toBe(path);
    });
  }
});

// --- 2. /admin protégé ------------------------------------------------------

test.describe('Visiteur — accès admin bloqué', () => {
  test('GET /admin sans cookie → redirige (login ou /admin/login)', async ({
    page,
  }) => {
    await page.goto('/admin', { waitUntil: 'load' });
    const url = new URL(page.url());
    // Le middleware admin renvoie vers /admin/login OU /login selon le
    // setup. On accepte les 2 mais on refuse /admin tout court.
    expect(url.pathname).not.toBe('/admin');
    expect(['/admin/login', '/login']).toContain(url.pathname);
  });

  test('Le HTML de /admin ne contient pas le burger admin', async ({ page }) => {
    // Anti-leak : si le redirect 307 met du temps, on doit jamais voir
    // une frame avec "Espace admin". Ici on vérifie le HTML final.
    await page.goto('/admin', { waitUntil: 'load' });
    const html = await page.content();
    expect(html).not.toContain('Espace admin');
    expect(html).not.toContain('Tableau de bord');
  });
});

// --- 3. Pages publiques --- (couvert par public-pages.spec.ts) --------------

// On NE doublonne PAS public-pages.spec.ts ici. Ce fichier reste focus
// sur les redirects et l'absence de leak.

// --- 4. Home en mode visiteur -----------------------------------------------

test.describe('Visiteur — état de la home', () => {
  test('La home charge en 200 sans cookie', async ({ page }) => {
    const res = await page.goto('/', { waitUntil: 'load' });
    expect(res?.status()).toBeLessThan(400);
  });

  test('Aucun lien vers /admin dans le burger menu', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    const burger = page.getByRole('button', { name: /Menu|Ouvrir le menu/i });
    if (await burger.isVisible()) {
      await burger.click();
      // Petite attente pour l'animation d'ouverture
      await page.waitForTimeout(200);
      // Vérifie l'absence STRICTE de liens admin (admin/*)
      const adminLinks = page.locator('a[href^="/admin"]');
      await expect(adminLinks).toHaveCount(0);
    }
  });

  test('Pas d\'avatar pré-rempli ni lien profil rempli', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    // L'avatar visitor a l'icône User Lucide par défaut ; un user connecté
    // aurait son avatar_url ou son initiale. On vérifie qu'aucun <img>
    // avatar n'est servi.
    const avatarImg = page.locator('img[alt*="avatar" i]');
    await expect(avatarImg).toHaveCount(0);
  });
});

// --- 5. Clics depuis la home → /login ---------------------------------------

test.describe('Visiteur — clics sur CTA protégés depuis la home', () => {
  // BottomNav contient les boutons "Liste de courses", "Favoris" qui sont
  // protégés en mode visiteur. Un clic doit déclencher la redirection.

  test('Clic BottomNav "Courses" → /login?next=/courses', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    const coursesBtn = page.getByLabel(/Liste de courses/i).first();
    await coursesBtn.click();
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('next')).toBe('/courses');
  });

  test('Clic BottomNav "Favoris" → /login?next=/favoris', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    // Le label peut varier ; on cherche par aria-label ou texte fallback.
    const favBtn = page
      .getByRole('link', { name: /Favoris/i })
      .or(page.getByLabel(/Favoris/i))
      .first();
    if (await favBtn.isVisible()) {
      await favBtn.click();
      await page.waitForURL(/\/login/, { timeout: 5_000 });
      const url = new URL(page.url());
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('next')).toBe('/favoris');
    } else {
      test.skip(true, 'Bouton Favoris non visible dans le viewport courant');
    }
  });
});

// --- 6. Préservation du paramètre next --------------------------------------

test.describe('Visiteur — paramètre ?next= robuste', () => {
  test('F5 sur /login?next=/favoris préserve le paramètre', async ({ page }) => {
    await page.goto('/login?next=%2Ffavoris', { waitUntil: 'load' });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/favoris');
    await page.reload({ waitUntil: 'load' });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/favoris');
  });

  test('Cliquer "Mes courses" puis F5 sur /login garde next=/courses', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.getByLabel(/Liste de courses/i).first().click();
    await page.waitForURL(/\/login/, { timeout: 5_000 });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/courses');
    await page.reload({ waitUntil: 'load' });
    expect(new URL(page.url()).searchParams.get('next')).toBe('/courses');
  });
});

// --- 7. Anti-leak prefetch --------------------------------------------------

test.describe('Visiteur — pas de leak via prefetch Next.js', () => {
  // Next.js prefetche les <Link> visibles. Si un Link pointe vers une page
  // protégée, le prefetch doit renvoyer 307 ou un HTML vide, jamais le
  // contenu privé. Sinon un visiteur curieux qui inspecte le HTML
  // prefetché pourrait voir des données qu'il ne devrait pas voir.

  test('Fetch direct /favoris renvoie redirect, pas le contenu', async ({
    request,
  }) => {
    // Utilise request (pas page) pour ne PAS suivre les redirects.
    const res = await request.get('/favoris', { maxRedirects: 0 });
    // Doit être 30x (redirect) ou 401/403, surtout PAS 200 avec du HTML privé.
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(res.status());
  });

  test('Fetch direct /mes-calories renvoie redirect', async ({ request }) => {
    const res = await request.get('/mes-calories', { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(res.status());
  });

  test('Fetch direct /admin renvoie redirect', async ({ request }) => {
    const res = await request.get('/admin', { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403]).toContain(res.status());
  });
});

// --- 8. Idempotence clics multiples -----------------------------------------

test.describe('Visiteur — idempotence clics multiples', () => {
  test('Triple-clic burger ne casse pas l\'état du drawer', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    const burger = page.getByRole('button', { name: /Menu|Ouvrir le menu/i });
    if (!(await burger.isVisible())) {
      test.skip(true, 'Burger non visible — header différent dans ce viewport');
      return;
    }
    // 3 clics rapides → état final = ouvert (clic 1) → fermé (clic 2) → ouvert (clic 3)
    await burger.click();
    await burger.click();
    await burger.click();
    // L'overlay du drawer doit être présent ET cliquable (pas de double overlay
    // bloqué). On vérifie qu'un lien dans le drawer est interactable.
    const drawerLink = page
      .getByRole('link', { name: /À propos|Connexion|Recettes/i })
      .first();
    await expect(drawerLink).toBeVisible({ timeout: 2_000 });
  });

  test('Double-clic sur tuile Recettes ne crée pas 2 entrées history', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'load' });
    const startUrl = page.url();
    const recettesTile = page
      .getByRole('link', { name: /Idées recettes|Recettes/i })
      .first();
    if (!(await recettesTile.isVisible())) {
      test.skip(true, 'Tuile Recettes non visible');
      return;
    }
    // dblclick natif Playwright (2 clics rapides)
    await recettesTile.dblclick();
    // On attend que la nav arrive
    await page.waitForURL(/\/recettes|\/login/, { timeout: 5_000 });
    // back() doit nous ramener à la home (1 seule entrée history),
    // pas à une page intermédiaire.
    await page.goBack({ waitUntil: 'load' });
    expect(new URL(page.url()).pathname).toBe(new URL(startUrl).pathname);
  });
});
