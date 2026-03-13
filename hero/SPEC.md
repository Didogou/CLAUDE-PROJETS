# HERO — Spécification du Projet

> Application de livres "Dont Vous Êtes le Héros" générés par IA, dans le style littéraire de Pierre Bordage.

---

## Vue d'ensemble

**Hero** est une plateforme en deux parties :

1. **Admin** — une interface web permettant à l'administrateur de générer, valider et publier des livres interactifs via l'API Claude.
2. **Application mobile** — une app téléchargeable sur App Store et Google Play, où chaque version de l'application correspond à un livre unique, jouable par tous les utilisateurs.

---

## Stack Technique

| Composant | Technologie |
|---|---|
| Interface Admin | Next.js (TypeScript) |
| Application Mobile | React Native + Expo |
| Base de données | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Storage (images) | Supabase Storage |
| Génération de texte | API Claude (Anthropic) |
| Génération d'images | Replicate (modèle FLUX) |
| Animations | Lottie + Rive |
| Déploiement mobile | Expo EAS Build |
| Langues | Français 🇫🇷 et Anglais 🇬🇧 |

---

## Style Littéraire

Le contenu de chaque livre doit être rédigé dans le style de **Pierre Bordage** :

- Le début du roman doit contenir une ou deux pages de mise en contexte, lors des phases de tensions, utiliser des phrases courtes, rythmées, percutantes selon le type de section
- Atmosphère immersive et sensorielle (sons, odeurs, lumières)
- Tension narrative permanente
- Personnages profonds avec une dimension morale ou existentielle
- Univers cohérents et détaillés (SF, fantasy, post-apo, thriller...)
- Écriture à la deuxième personne du singulier ("Vous avancez dans l'obscurité...")
- Le thème de l'histoire doit largement s'inspirer de la description de l'admin
---

## Partie 1 — Interface Admin (Web)

### Accès
- Réservé à l'administrateur uniquement
- Authentification sécurisée via Supabase Auth

### Fonctionnalités

#### Génération d'un livre
L'administrateur remplit un formulaire de génération avec les paramètres suivants :

| Paramètre | Description | Exemples |
|---|---|---|
| Thème | L'univers du livre | Science-fiction, Fantasy, Post-apocalyptique, Médiéval, Cyberpunk... |
| Tranche d'âge | Public cible | 8-12 ans, 13-17 ans, Adulte (18+) |
| Type de contexte | Ambiance narrative | Intrigue, Suspense, Aventure, Enquête, Horreur, Romance... |
| Nombre de sections | Longueur du livre | 20 à 100 sections |
| Langue | Langue de génération | Français, Anglais |
| Titre | Titre du livre | Saisi manuellement ou suggéré par l'IA |

#### Validation des textes
- Chaque section générée est affichée dans un éditeur de texte
- L'administrateur peut modifier, reformuler ou régénérer une section
- Validation section par section ou globale
- Aperçu de l'arbre de décision (graphe des embranchements)

#### Publication
- Une fois validé, le livre est marqué comme "publié" en base de données
- Il devient accessible dans l'application mobile

#### Gestion des livres
- Liste de tous les livres (brouillons + publiés)
- Archivage / suppression d'un livre
- Visualisation de l'arbre narratif complet

---

## Partie 2 — Application Mobile

### Distribution
- App Store (iOS)
- Google Play (Android)
- Chaque version de l'application embarque **un seul livre**
- Tous les utilisateurs téléchargeant la même version accèdent au même livre

### Écran de démarrage
- Visuel thématique immersif selon l'univers du livre
- Titre et ambiance sonore (facultatif en v1)
- Bouton "Nouvelle Partie" / "Reprendre"

### Fiche Personnage

La fiche personnage est **accessible à tout moment** pendant l'aventure via un bouton permanent (icône en haut de l'écran). Elle affiche en temps réel :

- Nom, Métier et Archétype
- Toutes les caractéristiques avec leur valeur courante / valeur de base
- Les blessures actives et leurs malus
- L'inventaire complet
- Les points de Magie restants

---

### Création du Personnage

La création se déroule en 3 étapes :

#### Étape 1 — Tirage des caractéristiques

Les valeurs de base sont tirées au hasard. Le joueur peut relancer **une seule fois** l'ensemble avant de confirmer.

| Caractéristique | Description | Méthode | Plage de base |
|---|---|---|---|
| Nom | Nom du héros | Saisi par l'utilisateur | — |
| Force | Puissance physique, combat corps à corps | 2d6 | 2–12 |
| Agilité | Esquive, crochetage, furtivité, pièges | 2d6 | 2–12 |
| Intelligence | Énigmes, déduction, langues, stratégie | 2d6 | 2–12 |
| Magie | Puissance et réserve magique | 2d6 | 2–12 |
| Endurance | Points de vie (HP) | 2d6 + 6 | 8–18 |
| Chance | Relance de dé, coups de fortune | 1d6 + 3 | 4–9 |

> L'Endurance affiche deux valeurs : **HP max** (valeur tirée) et **HP courants** (évolue pendant l'aventure).

#### Étape 2 — Choix du Métier

Le métier est proposé **selon le contexte du livre**. Chaque métier applique des **bonus et malus** sur les caractéristiques de base.

**Exemples de métiers par thème :**

| Thème | Métier | Bonus | Malus |
|---|---|---|---|
| Médiéval / Fantasy | Chevalier | Force +3, Endurance +2 | Agilité -1, Magie -2 |
| Médiéval / Fantasy | Voleur | Agilité +3, Chance +1 | Force -1, Magie -1 |
| Médiéval / Fantasy | Sorcier | Magie +4, Intelligence +1 | Force -2, Endurance -2 |
| Médiéval / Fantasy | Barde | Chance +2, Intelligence +2 | Force -1, Endurance -1 |
| Science-Fiction | Pilote | Agilité +3, Intelligence +1 | Magie -3, Force -1 |
| Science-Fiction | Ingénieur | Intelligence +4 | Force -2, Magie -2 |
| Science-Fiction | Soldat | Force +3, Endurance +2 | Intelligence -1, Magie -2 |
| Post-Apo | Chasseur | Agilité +2, Force +1, Chance +1 | Magie -3 |
| Enquête / Thriller | Détective | Intelligence +4, Chance +1 | Force -2, Magie -3 |
| Enquête / Thriller | Agent secret | Agilité +2, Intelligence +2 | Endurance -1 |

> Les métiers disponibles sont définis par l'admin au moment de la création du livre, en cohérence avec l'univers.

#### Étape 3 — Équipement de départ

Chaque métier confère un **équipement de départ** adapté (ex: le Chevalier commence avec une épée et une armure légère, le Sorcier avec un grimoire et une potion de mana).

---

### Inventaire

L'utilisateur peut **ramasser, utiliser et perdre des objets** tout au long de l'aventure.

#### Fonctionnement
- L'inventaire est accessible depuis la fiche personnage
- Capacité maximale : **10 objets** (modifiable par le livre)
- Les objets sont définis par l'admin dans chaque section concernée
- Un objet peut être **actif** (utilisable) ou **passif** (bonus permanent)

#### Types d'objets

| Type | Effet | Exemples |
|---|---|---|
| Soin | Restaure des HP | Potion de soin (+4 HP), Herbes médicinales (+2 HP) |
| Mana | Restaure des points de Magie | Élixir de mana (+3 Magie) |
| Arme | Bonus de Force en combat | Épée enchantée (+2 Force au combat) |
| Armure | Réduit les dégâts reçus | Bouclier (-1 dégât par round) |
| Outil | Bonus sur épreuves spécifiques | Crochets (+2 Agilité pour crochetage) |
| Clé / Quête | Débloque des sections ou choix | Clé de la tour, Sceau royal |
| Grimoire | Débloque des sorts | Livre des Ombres (sort de télékinésie) |

> Certains choix ne sont disponibles que si le joueur possède un objet spécifique dans son inventaire.

---

### Mécaniques de Jeu

Les caractéristiques sont utilisées activement lors des épreuves rencontrées dans le livre. Chaque épreuve implique un **test de caractéristique** : le joueur lance 2d6, et doit obtenir un résultat **inférieur ou égal** à la valeur de sa stat.

#### Types d'épreuves

| Type d'épreuve | Stat utilisée | Exemple narratif |
|---|---|---|
| **Combat** | Force | Affronter un garde, briser une porte |
| **Esquive / Fuite** | Agilité | Eviter un piège, s'échapper d'une poursuite |
| **Crochetage de serrure** | Agilité | Forcer une serrure ancienne, désamorcer un mécanisme |
| **Énigme / Déduction** | Intelligence | Résoudre un rébus, déchiffrer un code, lire une inscription |
| **Magie / Invocation** | Magie | Lancer un sort, communiquer avec une entité, activer un artefact |
| **Coup de chance** | Chance | Trouver un objet caché, éviter une rencontre aléatoire |

#### Résolution d'un Test

```
Résultat du jet (2d6) ≤ valeur de la stat → Succès → section victoire
Résultat du jet (2d6) > valeur de la stat  → Échec  → section défaite / alternative
```

- **Succès critique** (résultat = 2) : effet bonus (objet trouvé, ennemi étourdi...)
- **Échec critique** (résultat = 12) : effet négatif (perte d'Endurance, malus temporaire...)
- La **Chance** peut être dépensée pour relancer un seul dé, une fois par test

#### Combat (détail)

Le combat se déroule en **rounds automatiques animés**, narrés dans le texte :

**Déroulement d'un round :**
1. Jet d'attaque joueur : 2d6 ≤ Force → succès → l'ennemi perd des HP
2. Jet d'attaque ennemi : 2d6 ≤ Force ennemi → succès → le joueur perd des HP
3. Les dégâts sont modulés par l'équipement (armes, armures)

**Tableau de dégâts de base :**
| Résultat du jet | Effet |
|---|---|
| Succès normal | 2 HP de dégâts infligés |
| Succès critique (jet = 2) | 4 HP de dégâts + chance de blessure ennemie |
| Échec normal | 2 HP perdus |
| Échec critique (jet = 12) | 4 HP perdus + jet de blessure pour le joueur |

**Fin de combat :**
- Ennemi à 0 HP → victoire, section suivante débloquée
- Joueur à 0 HP → mort du héros, écran de fin avec option de recommencer
- Fuite possible si un choix "Fuir" est présent (test Agilité)

> Les ennemis sont définis lors de la création du livre en fonction du niveau de difficulté
> Les ennemis sont de plus en plus fort ou puissant

#### Système de Blessures

Lors des combats ou des pièges, le personnage peut être **blessé**, ce qui réduit ses caractéristiques de manière temporaire ou permanente jusqu'à soins.

**Déclenchement d'une blessure :**
- Échec critique en combat (jet = 12)
- Certains pièges ou épreuves ratées
- L'admin peut définir des sections qui infligent automatiquement une blessure

**Types de blessures :**

| Blessure | Stat affectée | Malus | Condition de guérison |
|---|---|---|---|
| Bras cassé | Force | -3 | Repos ou soin magique |
| Cheville foulée | Agilité | -2 | Repos ou herbes |
| Commotion | Intelligence | -2 | Repos ou potion |
| Brûlure magique | Magie | -3 | Soin magique uniquement |
| Blessure profonde | Endurance max | -4 | Potion de soin avancée |
| Empoisonnement | Endurance | -1 HP/section | Antidote |

- Un personnage peut cumuler plusieurs blessures
- Les malus s'appliquent immédiatement sur les stats courantes
- La blessure est visible sur la fiche personnage avec son malus associé
- Certaines sections offrent des soins qui retirent les blessures

#### Magie (détail)

- La stat **Magie** représente à la fois la puissance et la réserve de mana
- Chaque sort coûte des points de Magie (définis par la section)
- Si Magie = 0, les sorts échouent automatiquement
- Certains archétypes (Mage) récupèrent de la Magie à certaines sections clés

#### Effets sur l'Endurance

- Certains choix ou échecs font perdre des points d'Endurance
- Des potions, soins ou repos peuvent en restaurer
- L'Endurance courante est affichée en permanence dans l'interface
- À 0 Endurance → écran "Vous êtes mort" avec option de recommencer

### Lecture du Livre
- Chaque **section** est affichée avec :
  - Le texte narratif (style Pierre Bordage)
  - Une **image illustrative** générée par IA (FLUX via Replicate) correspondant à la scène
  - Une **animation Lottie** d'ambiance (transition, effet atmosphérique)
  - Les **choix disponibles** (2 à 4 options)

### Système de Sauvegarde
- La progression est automatiquement sauvegardée localement (AsyncStorage)
- Synchronisation optionnelle avec Supabase (si connexion disponible)
- L'utilisateur peut quitter et reprendre exactement à la même section
- Plusieurs sauvegardes possibles (plusieurs parties en parallèle)

### Compte Utilisateur (optionnel en v1)
- Inscription / connexion via Supabase Auth
- Synchronisation de la progression entre appareils
- Historique des aventures terminées

---

## Modèle de Données (Supabase)

### Table `books`
| Colonne | Type | Description |
|---|---|---|
| id | uuid | Identifiant unique |
| title | text | Titre du livre |
| theme | text | Thème (SF, Fantasy...) |
| age_range | text | Tranche d'âge |
| context_type | text | Type de contexte |
| language | text | Langue (fr / en) |
| status | enum | draft / published / archived |
| cover_image_url | text | URL de l'image de couverture |
| created_at | timestamp | Date de création |

### Table `sections`
| Colonne | Type | Description |
|---|---|---|
| id | uuid | Identifiant unique |
| book_id | uuid | Référence au livre |
| number | integer | Numéro de section |
| content | text | Texte narratif |
| image_url | text | URL de l'image illustrative |
| animation_key | text | Référence à l'animation Lottie |
| trial | jsonb | Épreuve associée (voir structure ci-dessous) |
| is_ending | boolean | Section finale (victoire ou défaite) |
| ending_type | enum | null / victory / death |

**Structure du champ `trial` (JSONB) :**
```json
{
  "type": "combat" | "agilite" | "intelligence" | "magie" | "chance" | "crochetage",
  "stat": "force" | "agilite" | "intelligence" | "magie" | "chance",
  "difficulty": 0,
  "success_section": "uuid",
  "failure_section": "uuid",
  "enemy": {
    "name": "Garde impérial",
    "force": 8,
    "endurance": 12,
    "description": "Un colosse en armure noire..."
  },
  "endurance_loss_on_failure": 2,
  "mana_cost": 0
}
```

### Table `choices`
| Colonne | Type | Description |
|---|---|---|
| id | uuid | Identifiant unique |
| section_id | uuid | Section source |
| label | text | Texte du choix affiché |
| target_section_id | uuid | Section de destination |
| requires_trial | boolean | Ce choix déclenche une épreuve |
| condition | jsonb | Condition stat requise (ex: `{"stat": "magie", "min": 6}`) |

### Table `user_progress`
| Colonne | Type | Description |
|---|---|---|
| id | uuid | Identifiant unique |
| user_id | uuid | Utilisateur (ou device_id anonyme) |
| book_id | uuid | Livre en cours |
| current_section_id | uuid | Section actuelle |
| character | jsonb | Fiche personnage complète (voir structure) |
| updated_at | timestamp | Dernière mise à jour |

**Structure du champ `character` (JSONB) :**
```json
{
  "name": "Aldric",
  "job": "Chevalier",
  "stats": {
    "force":      { "base": 9, "current": 6 },
    "agilite":    { "base": 7, "current": 7 },
    "intelligence":{ "base": 6, "current": 4 },
    "magie":      { "base": 3, "current": 3 },
    "endurance":  { "base": 14, "max": 14, "current": 8 },
    "chance":     { "base": 6, "current": 5 }
  },
  "injuries": [
    { "name": "Bras cassé", "stat": "force", "malus": -3, "cured": false }
  ],
  "inventory": [
    { "id": "sword_01", "name": "Épée enchantée", "type": "arme", "effect": { "stat": "force", "bonus": 2 } },
    { "id": "potion_01", "name": "Potion de soin", "type": "soin", "hp_restore": 4, "quantity": 2 }
  ]
}
```

---

## Génération IA — Prompts

### Génération d'une section (Claude API)
```
Tu es un auteur de livres "Dont Vous Êtes le Héros" dans le style de Pierre Bordage.
Génère la section [numéro] d'un livre de type [contexte] dans un univers [thème],
destiné à un public [tranche d'âge], en [langue].

Règles d'écriture :
- Texte à la 2ème personne du singulier, immersif, rythmé, avec tension narrative
- Phrases courtes et percutantes, atmosphère sensorielle

Si cette section contient une épreuve, précise dans le JSON de retour :
- Le type : combat / crochetage / enigme / magie / chance / esquive
- La stat testée et la difficulté
- Les sections cibles en cas de succès et d'échec
- Si combat : nom, Force et Endurance de l'ennemi

Termine par [nombre] choix narratifs menant aux sections [liste de sections cibles].
```

### Génération d'image (Replicate / FLUX)
```
[Style: cinematic illustration, detailed, atmospheric]
Scene from a [thème] story: [résumé de la section en 1 phrase].
Mood: [contexte]. Target audience: [tranche d'âge].
```

---

## Phases de Développement

### Phase 1 — Backend & Admin
- [ ] Setup Supabase (schéma BDD, auth, storage)
- [ ] Interface admin Next.js (formulaire de génération)
- [ ] Intégration API Claude (génération des sections)
- [ ] Système de validation des textes
- [ ] Génération et stockage des images (Replicate)
- [ ] Publication d'un livre

### Phase 2 — Application Mobile
- [ ] Setup Expo + React Native
- [ ] Écran d'accueil thématique
- [ ] Création du personnage (stats aléatoires)
- [ ] Lecteur de sections (texte + image + animation)
- [ ] Système de choix et navigation
- [ ] Sauvegarde locale (AsyncStorage)

### Phase 3 — Finalisation
- [ ] Internationalisation (i18n : FR / EN)
- [ ] Synchronisation cloud de la progression
- [ ] Animations Lottie par type d'ambiance
- [ ] Tests et QA
- [ ] Déploiement Expo EAS (App Store + Google Play)

---

## Notes & Contraintes

- Chaque application mobile = 1 livre unique (pas de catalogue in-app en v1)
- Les images sont pré-générées lors de la phase admin et stockées dans Supabase Storage
- L'application mobile fonctionne hors-ligne (texte + images en cache)
- Le style Pierre Bordage doit être intégré directement dans les prompts système de Claude
