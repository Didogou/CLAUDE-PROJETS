import { test as base, type Page } from '@playwright/test';

/**
 * Fixture d'auth — utilise un compte de test Supabase pour pré-loguer
 * la session avant chaque test. Les credentials viennent des env vars
 * (jamais commités !) :
 *
 *   E2E_TEST_USER_EMAIL=test@karine.fr
 *   E2E_TEST_USER_PASSWORD=...
 *
 * Configure ce compte dans Supabase Auth Dashboard avant le run.
 * Idéalement ce compte est dans un projet Supabase de STAGING, pas prod,
 * pour éviter de polluer les données réelles.
 *
 * Usage dans un spec :
 *   import { test, expect } from './fixtures/auth';
 *   test('test authentifié', async ({ authedPage }) => {
 *     await authedPage.goto('/favoris');
 *     ...
 *   });
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const email = process.env.E2E_TEST_USER_EMAIL;
    const password = process.env.E2E_TEST_USER_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'E2E_TEST_USER_EMAIL et E2E_TEST_USER_PASSWORD requis pour les tests auth. ' +
          'Crée un compte de test dans Supabase et exporte ces vars.',
      );
    }
    await page.goto('/login');
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByPlaceholder(/mot de passe|password/i).fill(password);
    await page.getByRole('button', { name: /se connecter|connexion/i }).click();
    // Attend la redirection post-login (home ou /profil)
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), {
      timeout: 10_000,
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
