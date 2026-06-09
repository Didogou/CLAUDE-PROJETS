# Cut over Production — Karine Diététique

Liste centralisée de **tout ce qu'il faut faire en dehors du code** pour que la prod marche : configs Supabase Cloud, variables d'environnement Vercel, configs Stripe, templates d'e-mail, migrations SQL à appliquer.

Chaque case à cocher → action concrète à faire dans le dashboard correspondant.

> **Convention** : chaque section liste l'action, où la faire, et la conséquence si on oublie. Quand on règle un point, on coche et on date à droite (ex: `✅ 2026-06-08`).

---

## 1. Migrations SQL Supabase

Migrations à appliquer sur le projet **Supabase Cloud Karine** (pas local).

Pour chaque migration : **Dashboard Supabase → SQL Editor → New query → coller le contenu du fichier → Run**.

> ⚠️ Ne pas utiliser `supabase db push` si le projet local diverge de prod — ça écraserait des choses. Application manuelle, fichier par fichier, dans l'ordre chronologique du nom.

### Migrations en attente

- [ ] `supabase/migrations/20260606200000_tips_advice_is_public.sql` — colonne `is_public` sur tips + advice (toggle Globe/Lock admin)
- [ ] `supabase/migrations/20260606210000_health_advice_is_public.sql` — colonne `is_public` sur `health_advice` (vraie table conseils, vs legacy `advice`)
- [ ] `supabase/migrations/20260606210000_nutrition_target_horizon.sql` — colonne `target_horizon_months` sur `user_nutrition_targets`
- [ ] `supabase/migrations/20260606220000_portion_foods_ai_generated.sql` — colonne `ai_generated` sur `portion_foods` (badge IA + bouton Valider)

### Vérification post-application

- [ ] Ouvrir `/admin` → onglet Conseils santé : le bouton Globe/Lock doit fonctionner sans erreur 500
- [ ] Ouvrir `/mes-stats` : la phrase profil doit afficher l'horizon (« sur N mois »)
- [ ] Ouvrir `/admin` → Portions : badge IA + bouton ✅ Valider visibles

---

## 2. Variables d'environnement (Vercel)

Dashboard Vercel → projet karine → **Settings → Environment Variables**. Saisir pour **Production** (et Preview si tu veux que les PR builds tournent).

### Supabase Cloud Karine

- [ ] `NEXT_PUBLIC_SUPABASE_URL` — URL du projet Supabase Cloud (ex: `https://xxx.supabase.co`)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` — clé `anon` (publique, lecture seule via RLS)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` — clé `service_role` (⚠️ secret absolu, bypass RLS, jamais côté client)

### Stripe (paiements)

- [ ] `STRIPE_SECRET_KEY` — clé `sk_live_...` du compte Stripe live
- [ ] `STRIPE_WEBHOOK_SECRET` — secret du webhook `/api/stripe/webhook` (cf. section 4)
- [ ] `STRIPE_PRICE_MONTHLY` — `price_...` du plan mensuel (8 €/mois) en mode live
- [ ] `STRIPE_PRICE_YEARLY` — `price_...` du plan annuel (80 €/an) en mode live

> Si ces vars manquent → 500 au démarrage sur tout ce qui touche Stripe (page /mon-plan partiellement, /api/checkout, webhook). Le proxy `lib/stripe.ts` lazy-init, donc l'app tourne tant que personne ne paie, mais c'est bancal.

### Mistral (parsing aliments, suggestions diététiques)

- [ ] `MISTRAL_API_KEY` — clé Mistral La Plateforme

> Indispensable pour `/api/nutrition/parse` (logger un repas en langage naturel) et tout le flow Calorie Sheet.

### Anthropic (Claude — chat IA assistant)

- [ ] `ANTHROPIC_API_KEY` — clé Anthropic

> Utilisée par `/api/ai/chat` côté hero (peut être absent sur karine si pas branché ; vérifier).

### Google Vision (OCR / image analysis — optionnel)

- [ ] `GOOGLE_CLOUD_VISION_API_KEY` — si vous l'utilisez encore en prod (sinon laisser vide)

### App URL & cron

- [ ] `NEXT_PUBLIC_APP_URL` — URL publique de l'app (ex: `https://karine-dietetique.fr`)
- [ ] `CRON_SECRET` — secret partagé pour les routes `/api/cron/*` (généré aléatoirement, doit matcher avec le header `Authorization: Bearer <CRON_SECRET>` côté Vercel Cron)

### E-mails transactionnels (Resend)

- [ ] `RESEND_API_KEY` — clé API Resend
- [ ] `EMAIL_FROM` — adresse expéditrice vérifiée chez Resend (ex: `Karine Diététique <hello@karine-dietetique.fr>`)
- [ ] `EMAIL_TO_ADMIN` — adresse de Karine pour recevoir les notifications admin (nouvelles demandes patient, etc.)

> ⚠️ **Resend ne sert PAS pour le reset password Supabase** (qui passe par le SMTP configuré dans Supabase — cf. section 3). Resend sert pour les e-mails métier déclenchés par l'app (notifications, demandes, etc.).

---

## 3. Supabase Cloud Karine — Configuration Auth

Dashboard Supabase → **Authentication**. Ces réglages sont indispensables pour que **login / signup / reset password / e-mail de confirmation** marchent en prod.

### 3.1 URL Configuration

Dashboard → **Authentication → URL Configuration**

- [ ] **Site URL** : `https://karine-dietetique.fr` (URL prod)
- [ ] **Redirect URLs** (liste blanche) — ajouter tout ce qui suit, sinon les liens dans les e-mails renvoient sur une page d'erreur Supabase :
  - `https://karine-dietetique.fr/nouveau-mot-de-passe` (lien reset password)
  - `https://karine-dietetique.fr/auth/callback` (OAuth Google + Facebook)
  - `https://karine-dietetique.fr/**` (wildcard — pratique pour les `?next=…` de post-login)
  - `http://localhost:3000/**` (dev local)
  - URL preview Vercel si on veut tester les PR builds : `https://karine-*.vercel.app/**`

### 3.2 SMTP custom (envoi d'e-mails Auth)

Dashboard → **Authentication → SMTP Settings**

> Pourquoi custom : le SMTP par défaut de Supabase est limité à **2 e-mails/heure par projet** et passe à du « best effort » sur le plan free. En prod ça ne tient pas. Soit on prend Resend SMTP, soit Brevo (ex-Sendinblue) qui a un free tier généreux.

**Option recommandée — Resend SMTP** (gratuit jusqu'à 3 000 mails/mois, tu as déjà la clé pour les e-mails métier) :

- [ ] **Host** : `smtp.resend.com`
- [ ] **Port** : `465` (SSL) ou `587` (STARTTLS)
- [ ] **Username** : `resend`
- [ ] **Password** : ta clé API Resend (la même que `RESEND_API_KEY` côté Vercel)
- [ ] **Sender email** : adresse vérifiée chez Resend (doit matcher avec un domaine prouvé dans Resend, ex: `noreply@karine-dietetique.fr`)
- [ ] **Sender name** : `Karine Diététique`
- [ ] Cocher **Enable Custom SMTP**

> Vérifier après config : Dashboard → **Authentication → Users → ouvrir un user de test → Send password reset**. L'e-mail doit arriver dans la minute.

### 3.3 Templates d'e-mail en français

Dashboard → **Authentication → Email Templates**. Par défaut tout est en anglais. Reformuler en français.

> ⚠️ Conserver les variables Go templates intactes : `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .Token }}`, `{{ .SiteURL }}`. Ne pas les traduire.

#### Template **Confirm signup** (e-mail de confirmation à l'inscription)

- [ ] **Subject** : `Confirme ton inscription chez Karine Diététique`
- [ ] **Body** :

```html
<h2>Bienvenue chez Karine Diététique 🌸</h2>

<p>Merci de t'être inscrite. Pour activer ton compte, clique sur le bouton ci-dessous :</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="display:inline-block;padding:12px 24px;background:#e2788d;color:#ffffff;
            border-radius:9999px;text-decoration:none;font-weight:bold">
    Confirmer mon adresse e-mail
  </a>
</p>

<p>Si le bouton ne marche pas, copie-colle ce lien dans ton navigateur :<br>
<a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>

<p>Si tu n'as pas créé de compte, ignore cet e-mail.</p>

<p>À bientôt,<br>L'équipe Karine Diététique</p>
```

#### Template **Reset password**

- [ ] **Subject** : `Réinitialise ton mot de passe — Karine Diététique`
- [ ] **Body** :

```html
<h2>Réinitialisation de ton mot de passe</h2>

<p>Tu as demandé à réinitialiser ton mot de passe sur Karine Diététique. Clique sur le bouton ci-dessous pour en choisir un nouveau :</p>

<p>
  <a href="{{ .ConfirmationURL }}"
     style="display:inline-block;padding:12px 24px;background:#e2788d;color:#ffffff;
            border-radius:9999px;text-decoration:none;font-weight:bold">
    Choisir un nouveau mot de passe
  </a>
</p>

<p>Si le bouton ne marche pas, copie-colle ce lien dans ton navigateur :<br>
<a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>

<p>Ce lien expire dans 1 heure. Si tu n'as pas fait cette demande, ignore cet e-mail — ton mot de passe actuel reste inchangé.</p>

<p>À bientôt,<br>L'équipe Karine Diététique</p>
```

#### Template **Magic Link** (si activé)

- [ ] **Subject** : `Ton lien de connexion — Karine Diététique`
- [ ] Adapter sur le même modèle que ci-dessus

#### Template **Change Email Address** (changement d'e-mail)

- [ ] À traduire si le flow change-email est utilisé en prod (sinon ignorer)

### 3.4 Providers OAuth

Dashboard → **Authentication → Providers**

- [ ] **Google** : activé, client ID + secret renseignés depuis Google Cloud Console (OAuth 2.0 credentials)
- [ ] **Facebook** : activé, App ID + App Secret depuis Meta for Developers
- [ ] **Authorized JavaScript origins** côté Google : `https://karine-dietetique.fr` + URL preview Vercel si besoin
- [ ] **Authorized redirect URIs** côté Google : `https://<projet>.supabase.co/auth/v1/callback`

---

## 4. Stripe — Cut over Live mode

Dashboard Stripe → toggle **Test / Live** en haut à droite. Travailler en mode **Live** pour la prod.

### 4.1 Produits & Prix

- [ ] **Produit** « Karine Diététique — Abonnement » créé en mode live
- [ ] **Prix Mensuel** : 8 €/mois récurrent → noter l'ID `price_...` → reporter dans `STRIPE_PRICE_MONTHLY`
- [ ] **Prix Annuel** : 80 €/an récurrent → noter l'ID `price_...` → reporter dans `STRIPE_PRICE_YEARLY`

### 4.2 Webhook

Dashboard Stripe → **Developers → Webhooks → Add endpoint**

- [ ] **Endpoint URL** : `https://karine-dietetique.fr/api/stripe/webhook`
- [ ] **Events à écouter** :
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
- [ ] Récupérer le **Signing secret** (`whsec_...`) → reporter dans `STRIPE_WEBHOOK_SECRET`

### 4.3 Customer Portal (gestion de l'abonnement par l'utilisatrice)

Dashboard Stripe → **Settings → Billing → Customer portal**

- [ ] Activer le portal
- [ ] Cocher : « **Annuler les abonnements** » + « **Mettre à jour le moyen de paiement** » + « **Voir l'historique des factures** »
- [ ] **Cancellation policy** : « À la fin de la période de facturation »
- [ ] **Branding** : logo Karine + couleurs coral

---

## 5. Supabase Cloud Karine — Storage

Dashboard Supabase → **Storage**. Vérifier que les buckets utilisés par l'app existent en prod :

### Buckets nécessaires

- [ ] `nutrition-meal-photos` — photos de repas uploadées par les utilisatrices (privé, accès via RLS)
- [ ] `ciqual-images` — images générées pour les aliments Ciqual (public, lecture seule)
- [ ] `recipes` — illustrations recettes (public)
- [ ] `tips` — illustrations astuces (public)
- [ ] `profiles` — avatars (public)

### Policies RLS Storage

> Les policies Storage sont **distinctes** des policies des tables. À vérifier sur chaque bucket :

- [ ] `nutrition-meal-photos` : INSERT autorisé pour `auth.uid()`, SELECT autorisé seulement pour le owner du fichier (path commence par `{auth.uid()}/`)
- [ ] Buckets publics (`ciqual-images`, `recipes`, `tips`, `profiles`) : SELECT public, INSERT réservé au `service_role` (et donc aux routes admin)

---

## 6. Vercel — Configuration runtime

### 6.1 Region

- [ ] Region : **CDG (Paris)** ou **FRA (Frankfurt)** pour minimiser la latence vers Supabase EU + utilisatrices FR

### 6.2 Cron jobs

`vercel.json` doit déclarer les crons. Vérifier que tous les jobs déclarés ont leur secret partagé `CRON_SECRET` correctement passé en `Authorization`.

- [ ] Cron `/api/cron/...` — lister ici les crons connus quand on les active (à compléter au fur et à mesure)

### 6.3 Domaine

- [ ] Domaine principal : `karine-dietetique.fr` (avec www → apex redirect)
- [ ] HTTPS forcé
- [ ] DNS : enregistrements A / CNAME pointant sur Vercel (cf. doc Vercel)

---

## 7. Smoke tests post-cutover

À faire **après** toutes les configs ci-dessus, sur l'URL de prod, avec un compte de test.

### Auth

- [ ] **Signup** : créer un compte → recevoir l'e-mail de confirmation en français → cliquer → atterir connectée sur la home
- [ ] **Login** : mot de passe correct → home ; mot de passe faux → message FR « E-mail ou mot de passe incorrect. »
- [ ] **Mot de passe oublié** : taper son e-mail → recevoir le mail FR → cliquer → arriver sur `/nouveau-mot-de-passe` → saisir nouveau mdp → retour login OK
- [ ] **OAuth Google** : bouton « Continuer avec Google » → flow Google → retour sur la home, connectée
- [ ] **OAuth Facebook** : idem
- [ ] **Sign out** : burger → Se déconnecter → revient sur la home en mode visiteur

### Paywall

- [ ] **Visiteuse → tuile verrouillée** : modal Lock s'ouvre → « Voir mon plan » → /mon-plan → section Bienvenue (login + signup côte à côte)
- [ ] **Connectée sans abo → /mon-plan** : voir les cartes Mensuel / Annuel
- [ ] **Clic plan Mensuel** → CGV cochée → bouton Continuer → Stripe Checkout en live mode → carte test refusée (sinon `4242 4242 4242 4242` en mode test) → retour `/mon-plan?checkout=cancel` ou `?checkout=success`
- [ ] **Webhook** : payer une fois en live mode (avec ta vraie carte sur un plan de test à 1 €) → vérifier dans Stripe que le webhook a tiré → vérifier en BDD que la row `subscriptions` est créée
- [ ] **Customer Portal** : depuis `/mon-plan` connectée abonnée → bouton « Gérer la facturation » → portal Stripe s'ouvre → annuler l'abo → vérifier que `cancel_at_period_end=true` en BDD

### Métier

- [ ] **Logger un repas** : `/mes-repas` → ajouter un aliment via Mistral parsing → kcal correctes
- [ ] **Mes Stats** : phrase profil cliquable, drum pickers ouvrent, auto-save fonctionne
- [ ] **Vase eau** : pourcentage cohérent avec la consommation

### Mobile (iPhone)

- [ ] Tester sur Safari iOS réel : pas de scroll horizontal parasite, header sticky se comporte bien, BottomNav fixe, FAB « Une idée » présent uniquement sur la home

---

## 8. Démarches juridiques (à confier au juriste / avocat)

À traiter AVANT mise en production publique. Cf. audit sécurité
2026-06-08 + sessions de cadrage juridique.

### 8.1 Structures & contrats

- [ ] **Choix de la structure juridique** (toi = éditeur logiciel) :
      EI / EURL / SASU selon situation perso → valider avec
      expert-comptable
- [ ] **Choix de la structure de Karine** : EI auto-entrepreneur ou
      réel BNC selon CA prévisionnel
- [ ] **Contrat de licence d'utilisation de l'application** entre toi
      (éditeur) et Karine (licenciée) : 12 points clés cf. brief
      avocat (objet, durée, rémunération 2€/abonné, propriété
      intellectuelle, maintenance, évolutions, exclusivité, sortie,
      non-concurrence, confidentialité, juridiction)
- [ ] **DPA RGPD Art. 28** (Data Processing Agreement) annexé au
      contrat de licence : Karine = responsable de traitement,
      toi = sous-traitant technique
- [ ] **CGU + CGV** adaptées au contexte santé + abonnement Stripe +
      droit de rétractation 14 jours (Karine = professionnelle santé,
      patients = consommateurs)
- [ ] **Politique de confidentialité** : déjà complétée côté code
      (sous-traitants Vercel/Supabase/Stripe/Resend/Anthropic/Mistral/
      Google OAuth + transferts hors UE encadrés). À valider par
      l'avocat avant publication.

### 8.2 Conformité réglementaire

- [ ] **Mentions légales** : remplir `legal_settings` en admin avec
      SIRET réel, raison sociale, contact RGPD valide. Sans ça, les
      placeholders `[NOM SOCIÉTÉ]` apparaissent sur les pages légales.
- [ ] **Question des mineures 15-17 ans** : validé par l'avocat ?
      Pour l'instant code = blocage strict < 15 ans (majorité
      numérique FR Art. 8 RGPD), pas de consentement parental géré.
- [ ] **Responsabilité diététique** : clause limitative au profit de
      Karine en cas de suivi alimentaire ayant des conséquences
      (TCA notamment).
- [ ] **Déclaration CNIL** : registre Art. 30 RGPD à constituer
      (activités de traitement, sous-traitants, durées de conservation).
- [ ] **DPO** : Karine doit-elle désigner un Délégué à la Protection
      des Données ? Pas obligatoire si activité non massive, mais
      recommandé vu la nature santé.

### 8.3 Marques et propriété intellectuelle

- [ ] **Charte d'engagement Nutri-Score** auprès de Santé publique
      France (gratuite, en ligne via santepubliquefrance.fr) — pour
      utiliser légalement le logo officiel Nutri-Score sur les fiches
      recettes. Documents à fournir : SIRET, raison sociale, identité
      du responsable, description du service.
- [ ] **Dépôt INPI** de la marque « Karine Diététique » si on veut
      protéger le nom à terme.
- [ ] **Mentions de copyright** sur les images et contenus créés par
      Karine (textes, photos de recettes).

### 8.4 Préparation du rendez-vous avocat

Documents à apporter :
- Politique de confidentialité actuelle (`/confidentialite`)
- CGU / CGV actuelles
- Schéma de fonctionnement (qui collecte quoi, qui paie qui)
- Liste des sous-traitants (cf. section 5 de la politique)
- Rapport d'audit sécurité (résumé du Workflow Claude 2026-06-08)

Coût indicatif : 150-250€/h conseil ponctuel, pack complet
(CGU + CGV + Confidentialité + DPA + contrat licence) ≈ 1500-3000€.

---

## 9. Monitoring post-launch

À configurer / surveiller la première semaine :

- [ ] **Vercel Analytics** activé (Settings → Analytics)
- [ ] **Vercel Logs** : surveiller `/api/checkout`, `/api/stripe/webhook`, `/api/nutrition/parse` pour les erreurs
- [ ] **Supabase Logs** : Auth → Logs (vérifier que les emails partent vraiment), Storage → Logs (uploads OK)
- [ ] **Resend Logs** : taux de délivrabilité des e-mails métier
- [ ] **Stripe Dashboard** : Disputes, Failed payments, Webhook deliveries (doit être 100% green)

---

## Historique de cutover

| Date | Section | Note |
|------|---------|------|
| 2026-06-08 | Initial | Création du fichier |
