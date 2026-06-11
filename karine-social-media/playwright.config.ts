import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — Karine Diététique.
 *
 * Tests E2E qui pilotent un vrai navigateur. Le dev server tourne sur
 * port 3100 (cf. npm run dev). `webServer` permet à Playwright de
 * démarrer le dev server automatiquement si tu lances `npm run test:e2e`
 * sans dev déjà actif.
 *
 * Lancement :
 *   npm run test:e2e         # CLI headless
 *   npm run test:e2e:ui      # mode interactif (debug)
 *   npm run test:e2e:debug   # avec inspector
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // 2 workers max : ton dev Next.js est single-thread, 10 workers
  // parallèles le saturent et tous les tests timeout. 2 = bon compromis
  // vitesse / fiabilité quand on lance depuis /admin/tests.
  workers: 2,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Mobile iPhone 12 = profil de référence pour Karine (la plupart
      // des utilisatrices sur smartphone).
      name: 'mobile-iphone',
      use: { ...devices['iPhone 12'] },
    },
  ],
  // Pas de webServer auto : conflit observé quand on lance depuis
  // /admin/tests (ton dev tourne déjà → Playwright essaie de spawn
  // un 2e dev sur le port 3100 → port pris → tests timeout).
  // Pour le terminal/CI, démarre `npm run dev` à la main avant.
});
