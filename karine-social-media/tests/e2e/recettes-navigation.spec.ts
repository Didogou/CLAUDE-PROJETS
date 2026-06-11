import { expect, test } from '@playwright/test';

/**
 * Scénario 2 — Navigation et filtres sur /recettes.
 *
 * Vérifie que :
 *  - La page se charge
 *  - Les 4 toggles (Saison, Végé, Gluten, Porc) sont présents
 *  - Cliquer sur l'onglet Plats change l'URL/onglet actif
 *  - Le toggle Gluten devient actif au clic
 */
test.describe('Page /recettes', () => {
  test('affiche la barre de recherche', async ({ page }) => {
    await page.goto('/recettes');
    await expect(
      page.getByPlaceholder(/Rechercher une recette/i),
    ).toBeVisible();
  });

  test('affiche les 4 toggles filtre + bouton Nutri', async ({ page }) => {
    await page.goto('/recettes');
    // Les labels courts
    await expect(page.getByRole('button', { name: /Saison/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Végé/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Gluten/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Porc/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nutri/i })).toBeVisible();
  });

  test('toggle Gluten devient actif (aria-pressed=true) au clic', async ({
    page,
  }) => {
    await page.goto('/recettes');
    const glutenBtn = page.getByRole('button', { name: /Gluten/i });
    await expect(glutenBtn).toHaveAttribute('aria-pressed', 'false');
    await glutenBtn.click();
    await expect(glutenBtn).toHaveAttribute('aria-pressed', 'true');
    // Re-click → reviens à inactif
    await glutenBtn.click();
    await expect(glutenBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('la recherche persiste entre catégories', async ({ page }) => {
    await page.goto('/recettes');
    const search = page.getByPlaceholder(/Rechercher une recette/i);
    await search.fill('pâte');
    // Clique l'onglet Plats si présent
    const platsTab = page.getByRole('button', { name: /^Plats$/i });
    if (await platsTab.isVisible()) {
      await platsTab.click();
      // La recherche doit toujours afficher "pâte"
      await expect(search).toHaveValue('pâte');
    }
  });
});
