import { expect, test } from '@playwright/test';

/**
 * Smoke tests — vérifie juste que les pages répondent en 200.
 * Si TOUS ces tests passent, le dev server tourne correctement.
 * Si TOUS échouent, le webServer Playwright ne démarre pas le dev
 * server ou il y a un guard auth qui redirige.
 */
test.describe('Smoke — pages publiques répondent en 200', () => {
  test('GET / répond 200', async ({ page }) => {
    const res = await page.goto('/');
    expect(res?.status()).toBeLessThan(400);
  });

  test('GET /recettes répond 200', async ({ page }) => {
    const res = await page.goto('/recettes');
    expect(res?.status()).toBeLessThan(400);
  });

  test('GET / contient le mot Karine quelque part dans le DOM', async ({
    page,
  }) => {
    await page.goto('/');
    // Attendre le full load puis chercher Karine n'importe où
    const text = await page.locator('body').innerText();
    expect(text).toMatch(/Karine/i);
  });

  test('GET /recettes contient une barre de recherche (input search)', async ({
    page,
  }) => {
    await page.goto('/recettes');
    // innerText ne lit pas l'attribut placeholder → on cible
    // directement l'input via getByPlaceholder.
    await expect(
      page.getByPlaceholder(/Rechercher une recette/i),
    ).toBeVisible();
  });
});
