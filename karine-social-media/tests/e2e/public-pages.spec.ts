import { expect, test } from '@playwright/test';

/**
 * Toutes les pages PUBLIQUES (sans auth) doivent répondre 200 + avoir
 * un titre visible. Si une page renvoie 404/500, ce test casse.
 */
const PUBLIC_PATHS = [
  { path: '/', expects: /Karine/i },
  { path: '/recettes', expects: /Rechercher une recette|Idées recettes/i },
  { path: '/menus', expects: /Menu|Semaine|menus/i },
  { path: '/astuces', expects: /Astuce/i },
  { path: '/conseils', expects: /Conseil/i },
  { path: '/a-propos', expects: /À propos|Mon approche|Karine/i },
  { path: '/tutos', expects: /Tutos|Bientôt/i },
  { path: '/mentions-legales', expects: /Mentions légales/i },
  { path: '/cgu', expects: /CGU|Conditions/i },
  { path: '/cgv', expects: /CGV|Vente/i },
  { path: '/confidentialite', expects: /Confidentialité|Cookies|RGPD/i },
];

for (const { path, expects } of PUBLIC_PATHS) {
  test(`Page publique ${path} répond 200 et contient ${expects}`, async ({
    page,
  }) => {
    // waitUntil: 'load' au lieu du default 'domcontentloaded' pour
    // attendre le SSR complet — sinon le innerText peut être vide
    // en première lecture sur les pages avec data fetching lent.
    const res = await page.goto(path, {
      waitUntil: 'load',
      timeout: 20_000,
    });
    expect(res?.status()).toBeLessThan(400);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(expects);
  });
}
