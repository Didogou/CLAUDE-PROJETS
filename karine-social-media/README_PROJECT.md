# Karine Piffaretti — Générateur de contenus Social Media

## Vue d'ensemble

Application web de génération automatique de posts Instagram et Facebook pour **Karine Piffaretti, Diététicienne-Nutritionniste** (Sillingy & Seynod).

L'outil permet de :
- Générer un **menu diététique de la semaine** chaque dimanche
- Produire un **post recette quotidien** à partir des photos de Karine
- Générer **3 posts conseils diététiques par semaine**
- Préparer chaque post sous forme de **visuel prêt à publier** pour validation avant mise en ligne

---

## Intervenants

| Rôle | Personne | Accès |
|---|---|---|
| Gestion & production | Didier | Accès complet |
| Validation & publication | Karine Piffaretti | Accès complet |

---

## Comptes cibles

- **Facebook** : [Karine Dietetique](https://www.facebook.com/KarineDietetique)
- **Instagram** : [@Karine_dieteticienne](https://www.instagram.com/Karine_dieteticienne)

---

## Calendrier éditorial

| Jour | Contenu |
|---|---|
| Lundi | Recette du jour + Conseil diététique |
| Mardi | Recette du jour |
| Mercredi | Recette du jour + Conseil diététique |
| Jeudi | Recette du jour |
| Vendredi | Recette du jour + Conseil diététique |
| Samedi | Recette du jour |
| Dimanche | Recette du jour + **Menu de la semaine** |

---

## Fonctionnalités détaillées

### 1. Menu de la semaine (chaque dimanche)

**Deux modes de génération :**

- **Mode automatique** : l'appli propose un menu complet de 7 dîners, Karine valide ou ajuste
- **Mode guidé** : Karine renseigne quelques paramètres, l'appli génère en tenant compte

**Contraintes appliquées à chaque menu généré :**
- Recettes de saison (en fonction du mois en cours)
- Temps de préparation court (< 30 min)
- Budget raisonnable
- Protéines variées sur la semaine (poisson, viande blanche, viande rouge, légumineuses, œufs)
- Équilibre diététique sans être extrême (plaisir + santé)
- Liste complète des ingrédients avec grammages et mesures

**Format du post dimanche :**
- Visuel récapitulatif des 7 dîners de la semaine
- Adapté Instagram & Facebook

---

### 2. Recette quotidienne

Les recettes publiées chaque jour correspondent au menu annoncé le dimanche.

**Workflow :**
```
Dimanche : menu de la semaine généré et publié
     ↓
Chaque jour : Karine prépare la recette du menu
     ↓
Karine charge sa photo (ou choisit une photo suggérée)
     ↓
L'appli génère la légende + hashtags
     ↓
Visuel post préparé → Karine valide → Karine publie
```

**Photos :**
- Karine charge ses propres photos du plat
- L'appli peut proposer des photos stock du plat (Unsplash)
- Plusieurs photos possibles par post (carrousel)

---

### 3. Conseil diététique (3×/semaine : lundi, mercredi, vendredi)

- Thèmes tournants : rééquilibrage alimentaire, vitamines/énergie, diabète, post-bariatrique, nutrition sportive, beauté par l'alimentation, saisonnalité
- Format court, actionnable, pédagogique
- Visuel texte généré automatiquement

---

## Workflow général

```
Utilisateur (Didier ou Karine)
     ↓
Ouvre l'application web
     ↓
Choisit le type de post à générer
     ↓
Remplit les paramètres (ou laisse l'auto)
     ↓
L'appli appelle Claude API → génère texte + structure visuelle
     ↓
Aperçu du post (visuel non publié)
     ↓
Karine valide ou demande une modification
     ↓
Post exporté / copié → Karine publie sur Instagram / Facebook
```

---

## Charte éditoriale

### Message central
> **"Maigrir ne veut pas dire souffrir"** — slogan Instagram
> **"Plaisir, variété, équilibre et santé"** — slogan site web

### Ton et style

| Critère | Valeur |
|---|---|
| Registre | Professionnel ET chaleureux |
| Adresse | **Vouvoiement** (vous, vos besoins, vos habitudes) |
| Style | Bienveillant, encourageant, pédagogique, jamais moralisateur |
| Ponctuation | Points d'exclamation assumés, majuscules pour l'emphase |
| Emojis | Mesurés — 1 à 3 par post (🌸 🎉 🥗 💪 🌿) |

### Formulations récurrentes
- "Maigrir ne veut pas dire souffrir"
- "Fini les régimes yo-yo !"
- "Oui aux invitations, oui au restaurant"
- "Sans frustration, sans privation"
- "Un programme adapté à VOS besoins"

### Structure d'une légende

```
[Accroche — question ou affirmation forte]

[Développement court, accessible, sans jargon]

[Astuce pratique ou bénéfice concret]

[Call-to-action : question à la communauté ou invitation à contacter]

[Hashtags]
```

### Hashtags

| Catégorie | Hashtags |
|---|---|
| Identité | #dieteticienne #nutritionniste #karinepiffaretti |
| Localisation | #annecy #hautesavoie #sillingy #seynod |
| Message | #rééquilibragealimentaire #mangeravecplaisir #minceur |
| Recette | #recettelegere #recettesaine #cuisinedietetique #ideesrepas |
| Conseil | #conseilnutrition #nutrition #bienetre #santeauquotidien |
| Spécialités | #chirurgiebariatrique #diabete #nutritionsportive |

### Identité visuelle
- **Palette** : vert (#2E7D5E), beige (#F5E6C8), crème (#FAFAF8), doré (#C9A84C)
- **Style** : épuré, lumineux, chaleureux — photos appétissantes sur fond clair
- **Watermark** : logo ou initiales "KP" sur chaque visuel généré
- **Typographie** : Cormorant Garamond (titres) + DM Sans (corps)

---

## Architecture technique

### Stack recommandée

| Couche | Technologie | Raison |
|---|---|---|
| Frontend + Backend | **Next.js** (React) | Full-stack en un seul projet, local facile, déploiement Vercel en 1 clic |
| Style | **Tailwind CSS** | Rapide, cohérent, facile à maintenir |
| IA | **Claude API** (Anthropic) | Génération des textes, menus, conseils |
| Base de données | **SQLite** (via Prisma) | Simple, local, portable |
| Photos stock | **Unsplash API** | Gratuit, qualité pro |
| Upload photos | Stockage local → cloud (Cloudinary) | Simple en local, scalable |
| Authentification | **NextAuth.js** | Login simple pour Karine et Didier |

### Hébergement
- **Local** : `npm run dev` — accessible sur le réseau local
- **Production** : Vercel (gratuit, déploiement depuis GitHub en 1 clic)

---

## Pages de l'application (wireframe)

```
/                     → Tableau de bord (posts à générer aujourd'hui)
/menu                 → Générateur de menu de la semaine
/recette              → Générateur de post recette (upload photo)
/conseil              → Générateur de post conseil diététique
/historique           → Posts générés et validés
/parametres           → Réglages (charte, hashtags, compte utilisateur)
```

---

## Prochaines étapes

- [x] Analyser les comptes Facebook et Instagram de Karine
- [x] Définir la charte éditoriale complète
- [x] Choisir le canal de dépôt des photos (email → upload dans l'appli)
- [x] Définir le canal de validation (visuel dans l'appli)
- [x] Choisir la stack technique (Next.js)
- [ ] Créer le projet Next.js
- [ ] Intégrer Claude API pour la génération de contenu
- [ ] Développer le générateur de menu de la semaine
- [ ] Développer le générateur de post recette
- [ ] Développer le générateur de conseil diététique
- [ ] Système d'upload / suggestion de photos
- [ ] Générateur de visuels (aperçu du post)
- [ ] Authentification (Karine + Didier)
- [ ] Tests sur 1 semaine pilote
- [ ] Déploiement sur Vercel
