import { expect, test } from './fixtures/auth';

/**
 * Flows authentifiés — nécessitent les env vars E2E_TEST_USER_EMAIL +
 * E2E_TEST_USER_PASSWORD (cf. fixtures/auth.ts).
 *
 * À lancer SÉPARÉMENT des tests publics, idéalement contre un projet
 * Supabase de STAGING.
 *
 * Skippé automatiquement si les env vars ne sont pas définies.
 */
test.skip(
  !process.env.E2E_TEST_USER_EMAIL || !process.env.E2E_TEST_USER_PASSWORD,
  'Skip : variables E2E_TEST_USER_EMAIL/PASSWORD non configurées',
);

test.describe('Flows authentifiés', () => {
  test('toggle favori sur une recette → apparaît dans /favoris', async ({
    authedPage: page,
  }) => {
    await page.goto('/recettes');
    const firstCard = page.locator('[data-recipe-id]').first();
    await firstCard.waitFor({ state: 'visible' });
    const recipeId = await firstCard.getAttribute('data-recipe-id');
    const bookmark = firstCard.getByRole('button', { name: /favoris/i });
    await bookmark.click();
    // Vérifie qu'on est marqué favori
    await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
    // Naviguer vers /favoris
    await page.goto('/favoris');
    // La recette ajoutée doit apparaître
    const favItem = page.locator(`a[href*="/recettes/${recipeId}"]`).first();
    await expect(favItem).toBeVisible();
  });

  test('like recette persiste après navigation', async ({ authedPage: page }) => {
    await page.goto('/recettes');
    const firstCard = page.locator('[data-recipe-id]').first();
    await firstCard.waitFor({ state: 'visible' });
    const like = firstCard.getByRole('button', { name: /^J'aime$|Retirer mon j'aime/i });
    const wasLiked = (await like.getAttribute('aria-pressed')) === 'true';
    if (!wasLiked) await like.click();
    // Navigue ailleurs puis reviens
    await page.goto('/');
    await page.goto('/recettes');
    const sameCard = page.locator('[data-recipe-id]').first();
    const sameLike = sameCard.getByRole('button', {
      name: /^J'aime$|Retirer mon j'aime/i,
    });
    await expect(sameLike).toHaveAttribute('aria-pressed', 'true');
  });

  test('/favoris : retrait via Trash icon', async ({ authedPage: page }) => {
    await page.goto('/favoris');
    const firstFav = page
      .locator('li')
      .filter({ has: page.getByRole('button', { name: /Retirer des favoris/i }) })
      .first();
    const trashBtn = firstFav.getByRole('button', { name: /Retirer des favoris/i });
    if (await trashBtn.isVisible()) {
      await trashBtn.click();
      // L'item doit disparaître (fade-out)
      await expect(firstFav).toHaveCSS('opacity', '0', { timeout: 3000 });
    }
  });
});
