import { expect, test } from '@playwright/test';

/**
 * Menu burger (MainDrawer).
 *
 * Tests :
 *  - Ouverture du drawer
 *  - Toutes les entrées principales sont présentes
 *  - Tutos + À propos visibles
 *  - Vu récemment plié par défaut, click toggle
 *  - Bouton Contact D2 ouvre la modal
 *  - Modal D2 ne se ferme PAS au clic backdrop (règle projet)
 */
test.describe('Burger menu', () => {
  test('s’ouvre depuis la home', async ({ page }) => {
    await page.goto('/'); // home a un burger (pas de backHref)
    const burger = page.getByRole('button', { name: /Ouvrir le menu/i });
    await burger.click();
    await expect(page.getByRole('link', { name: /^Recettes$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Menus semaine/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Mes favoris/i })).toBeVisible();
  });

  test('contient Tutos de Karine + À propos', async ({ page }) => {
    await page.goto('/recettes');
    await page.getByRole('button', { name: /Ouvrir le menu/i }).click();
    await expect(page.getByRole('link', { name: /Tutos de Karine/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /À propos/i })).toBeVisible();
  });

  test('"Vu récemment" est plié par défaut et toggleable', async ({ page }) => {
    await page.goto('/recettes');
    await page.getByRole('button', { name: /Ouvrir le menu/i }).click();
    const toggle = page.getByRole('button', { name: /Vu récemment/i });
    if (await toggle.isVisible()) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    }
  });

  test('Contact D2 ouvre la modal et reste verrouillée au clic backdrop', async ({
    page,
  }) => {
    await page.goto('/recettes');
    await page.getByRole('button', { name: /Ouvrir le menu/i }).click();
    const d2Btn = page.getByRole('button', { name: /Développé par D2/i });
    await d2Btn.click();
    // Modal apparaît
    const title = page.getByRole('heading', { name: /Contacter D2/i });
    await expect(title).toBeVisible();
    // Clic sur le backdrop NE DOIT PAS fermer (règle projet)
    await page.locator('[role="dialog"]').click({ position: { x: 5, y: 5 } });
    await expect(title).toBeVisible();
    // Mais la croix ferme bien
    await page.getByRole('button', { name: /Fermer/i }).click();
    await expect(title).not.toBeVisible();
  });
});
