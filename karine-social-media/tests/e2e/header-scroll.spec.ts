import { expect, test } from '@playwright/test';

/**
 * Comportement du header sticky au scroll.
 *
 * Tests :
 *  - Sur /recettes, le bloc sticky (barre recherche + toggles + tuiles)
 *    reste visible quand on scrolle
 *  - Le titre AppHeader passe en mode compact au scroll (texte plus petit)
 */
test.describe('Header sticky au scroll', () => {
  test('le bloc sticky reste visible au scroll sur /recettes', async ({
    page,
  }) => {
    await page.goto('/recettes');
    const searchBar = page.getByPlaceholder(/Rechercher une recette/i);
    await expect(searchBar).toBeVisible();
    // Scroll la page vers le bas
    await page.evaluate(() => window.scrollTo(0, 800));
    // La barre doit toujours être visible (sticky top)
    await expect(searchBar).toBeVisible();
  });

  test('le titre Idées recettes reste visible (mode compact) au scroll', async ({
    page,
  }) => {
    await page.goto('/recettes');
    await expect(page.getByText(/Idées recettes/i).first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 800));
    // Le titre est encore là (passe juste en taille plus petite)
    await expect(page.getByText(/Idées recettes/i).first()).toBeVisible();
  });

  test('quand le contenu tient à l’écran, pas de mode compact (anti-bounce iOS)', async ({
    page,
  }) => {
    await page.goto('/recettes');
    // Active une combinaison de filtres pour réduire la liste
    await page.getByRole('button', { name: /Saison/i }).click();
    await page.getByRole('button', { name: /Végé/i }).click();
    await page.getByRole('button', { name: /Gluten/i }).click();
    await page.getByRole('button', { name: /Porc/i }).click();
    // Petit scroll de tentative — ne doit pas activer compact mode
    await page.evaluate(() => window.scrollTo(0, 50));
    // Au lieu de matcher des classes (text-* matche aussi text-coral-dark
    // dans la regex), on vérifie la taille rendue du titre via
    // getBoundingClientRect. Au repos > 30px de haut, compact < 25px.
    const title = page.getByText(/Idées recettes/i).first();
    const height = await title.evaluate(
      (el) => (el as HTMLElement).getBoundingClientRect().height,
    );
    expect(height).toBeGreaterThan(28);
  });
});
