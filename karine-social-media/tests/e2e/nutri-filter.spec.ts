import { expect, test } from '@playwright/test';

/**
 * Scénario 3 — Filtre Nutri-Score : popover + toggle grades.
 *
 * Vérifie que :
 *  - Cliquer "Nutri" ouvre le popover des 5 grades
 *  - Cliquer un grade (ex. E) le déselectionne (visuel grisé)
 *  - Le bouton "Nutri" change d'état (filtre actif → fond coral)
 *  - "Tout sélectionner" reset au défaut
 */
test.describe('Filtre Nutri-Score', () => {
  test('clic sur Nutri ouvre le popover avec 5 grades A-E', async ({
    page,
  }) => {
    await page.goto('/recettes');
    const nutriBtn = page.getByRole('button', { name: /Filtrer par Nutri-Score/i });
    await nutriBtn.click();
    // Le popover montre "Décoche les grades..."
    await expect(
      page.getByText(/Décoche les grades que tu ne veux pas voir/i),
    ).toBeVisible();
    // Les 5 grades sont présents. On filtre sur les boutons qui ont
    // aria-pressed (= toggles de grade) + texte EXACT pour ne pas
    // matcher "Tout sélectionner" (qui contient C, E…).
    for (const grade of ['A', 'B', 'C', 'D', 'E']) {
      await expect(
        page.locator('[data-nutri-popover] button[aria-pressed]', {
          hasText: new RegExp(`^${grade}$`),
        }),
      ).toBeVisible();
    }
  });

  test('toggle grade E le déselectionne (aria-pressed=false)', async ({
    page,
  }) => {
    await page.goto('/recettes');
    await page.getByRole('button', { name: /Filtrer par Nutri-Score/i }).click();
    const gradeE = page.locator('[data-nutri-popover] button[aria-pressed]', {
      hasText: /^E$/,
    });
    // Initialement sélectionné
    await expect(gradeE).toHaveAttribute('aria-pressed', 'true');
    await gradeE.click();
    await expect(gradeE).toHaveAttribute('aria-pressed', 'false');
    // Le compteur affiche 4/5
    await expect(page.getByText(/4\/5 affichés?/i)).toBeVisible();
  });

  test('"Tout sélectionner" reset les grades', async ({ page }) => {
    await page.goto('/recettes');
    await page.getByRole('button', { name: /Filtrer par Nutri-Score/i }).click();
    // Décoche D et E (aria-pressed + texte exact pour pas matcher
    // « Tout sélectionner » qui contient ces lettres).
    await page
      .locator('[data-nutri-popover] button[aria-pressed]', { hasText: /^D$/ })
      .click();
    await page
      .locator('[data-nutri-popover] button[aria-pressed]', { hasText: /^E$/ })
      .click();
    await expect(page.getByText(/3\/5/)).toBeVisible();
    // Reset
    await page.getByRole('button', { name: /Tout sélectionner/i }).click();
    await expect(page.getByText(/5\/5/)).toBeVisible();
  });
});
