# Tests E2E Karine — Playwright

## Structure

```
tests/e2e/
├── fixtures/
│   └── auth.ts             # Login fixture (env vars requises)
├── smoke.spec.ts           # Smoke : home + recettes répondent 200
├── public-pages.spec.ts    # Toutes les pages publiques (200 + texte)
├── home.spec.ts            # Page d'accueil + BottomNav + burger
├── burger-menu.spec.ts     # Drawer + Vu récemment + Contact D2
├── recettes-navigation.spec.ts  # Recherche, toggles filtre
├── recettes-card.spec.ts   # Card click, like, bookmark
├── nutri-filter.spec.ts    # Popover Nutri-Score
├── header-scroll.spec.ts   # Sticky compact mode au scroll
└── authed-flows.spec.ts    # Flows authentifiés (skip si pas de creds)
```

## Lancer en local

```bash
# 1. Démarre le dev server dans un terminal
npm run dev

# 2. Dans un autre terminal, lance les tests
npm run test:e2e                              # tous
npm run test:e2e -- --project=chromium        # juste Chrome
npm run test:e2e -- --project=mobile-iphone   # juste mobile
npm run test:e2e:ui                           # mode interactif (debug)
npm run test:e2e -- tests/e2e/burger-menu.spec.ts  # un fichier
```

## Tests authentifiés

Les tests `authed-flows.spec.ts` nécessitent un compte de test Supabase.

### Créer le compte de test

1. Dashboard Supabase → Auth → Users → Add user
2. Email : `test@karine-dietetique.fr` (ou ton choix)
3. Password : généré aléatoirement
4. **Important** : utilise un projet Supabase de **STAGING**, pas prod, pour
   ne pas polluer les vraies données.

### Activer en local

```bash
export E2E_TEST_USER_EMAIL=test@karine-dietetique.fr
export E2E_TEST_USER_PASSWORD=...
npm run test:e2e
```

(sur Windows PowerShell : `$env:E2E_TEST_USER_EMAIL = '...'`)

## Automatisation CI

### GitHub Actions (déjà configuré)

`.github/workflows/e2e.yml` :
- Lance sur **chaque push/PR vers main**
- Lance **tous les jours à 4h UTC** (nightly)
- Matrice Chrome + Mobile iPhone (parallèle)
- Upload du rapport HTML en artifact (téléchargeable depuis l'UI GitHub)
- Traces des échecs uploadés séparément

### Secrets à configurer

Dans GitHub → Settings → Secrets and variables → Actions :
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- (optionnel) `E2E_TEST_USER_EMAIL` + `E2E_TEST_USER_PASSWORD`

### Notifications d'échec

Le workflow contient un job `notify-failure` qui se déclenche sur les runs
nocturnes en échec. À enrichir avec un webhook Slack/Discord ou un email
via Resend (l'API key Resend est déjà dans tes secrets si tu utilises
l'envoi d'emails de l'app).

Exemple webhook Discord (à ajouter dans le step `notify-failure`) :
```yaml
- name: Notify Discord
  if: env.DISCORD_WEBHOOK != ''
  env:
    DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
  run: |
    curl -X POST $DISCORD_WEBHOOK \
      -H 'Content-Type: application/json' \
      -d '{"content":"🚨 Karine E2E nightly failed: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}"}'
```

## Reporting & monitoring continu

### Rapport HTML local

```bash
npm run test:e2e:report   # ouvre le dernier rapport généré
```

### Trends (historique sur plusieurs runs)

Outils payants si tu veux du monitoring continu :

| Outil | Type | Note |
|---|---|---|
| [Currents.dev](https://currents.dev/) | Cloud dashboard | Gratuit jusqu'à ~30 runs/mois |
| [Trace.dev](https://trace.dev/) | Cloud | Free tier généreux, intègre Playwright nativement |
| [Allure](https://allurereport.org/) | Self-hosted | Open source, joli rapport |

Setup minimal Currents (exemple) :
```bash
npm i -D @currents/playwright
# Décore le playwright.config.ts avec leur reporter
```

## Bonnes pratiques

1. **1 fichier = 1 domaine UI** : burger-menu, recettes-card, etc.
2. **Selectors stables** : préférer `getByRole` + aria-label aux classes CSS
3. **Data attributes pour les tests** : `data-recipe-id`, `data-nutri-popover`
4. **Fast feedback** : `npm run test:e2e:ui` pour debug, pas le CLI
5. **Pas de sleep arbitraire** : utiliser `expect(locator).toBeVisible()` qui
   retry automatiquement
6. **Toujours nettoyer** : si un test crée un favori, il doit le retirer à la fin
