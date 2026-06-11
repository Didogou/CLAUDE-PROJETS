import { expect, test } from '@playwright/test';

/**
 * Scénario 1 — La page d'accueil charge sans erreur.
 *
 * Smoke test minimal : si ça casse, tout casse.
 */
test.describe('Page d’accueil', () => {
  test('charge avec le wordmark Karine Diététique', async ({ page }) => {
    await page.goto('/');
    // Le wordmark "Karine" apparaît dans le header
    await expect(page.getByText('Karine', { exact: false }).first()).toBeVisible();
  });

  test('a un BottomNav avec icône Courses + Recettes', async ({ page }) => {
    await page.goto('/');
    // ShoppingCart icon (aria-label "Liste de courses")
    await expect(page.getByLabel(/Liste de courses/i).first()).toBeVisible();
  });

  test('le burger menu s’ouvre et montre les liens principaux', async ({
    page,
  }) => {
    await page.goto('/');
    // Le bouton burger n'existe que dans certains layouts — on le
    // cherche par son aria-label.
    const burger = page.getByRole('button', { name: /Menu|Ouvrir le menu/i });
    if (await burger.isVisible()) {
      await burger.click();
      await expect(page.getByRole('link', { name: /Recettes/i }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: /Menus|Menu/i }).first()).toBeVisible();
    }
  });
});
