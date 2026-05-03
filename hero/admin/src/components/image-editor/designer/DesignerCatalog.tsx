'use client'
/**
 * DesignerCatalog — routeur qui dispatch vers le bon composant catalogue
 * selon la catégorie active du rail gauche.
 *
 * Phase 3 : Effets utilise WEATHER_PRESETS réels. Les autres catégories
 * affichent un placeholder structuré qui décrit ce qu'elles contiendront,
 * remplacé incrémentalement aux sprints suivants.
 */

import React from 'react'
import type { RailCategory } from './DesignerLeftRail'
import CatalogEffects from './catalogs/CatalogEffects'
import CatalogEdit from './catalogs/CatalogEdit'
import CatalogCharacters from './catalogs/CatalogCharacters'
import CatalogAnimation from './catalogs/CatalogAnimation'
import CatalogPlaceholder from './catalogs/CatalogPlaceholder'
import type { Character } from '@/lib/character-store'

/** Mode actif sur l'action Personnage (drive le contenu rendu quand
 *  category='generate' est ouverte par Personnage→sub-tool). */
export type PersonnageMode = 'add' | 'replace' | 'modify' | 'animate' | null

interface DesignerCatalogProps {
  category: RailCategory
  onClose: () => void
  /** Préfixe Supabase Storage (passé aux catalogs qui font des uploads :
   * ex. CatalogEdit pour ranger les masks/sprites de Découpe SAM) */
  storagePathPrefix: string
  /** Si l'utilisateur a déclenché un sub-tool de Personnage, route le
   *  catalog 'generate' vers la bonne vue (CatalogCharacters pour 'add'). */
  personnageMode?: PersonnageMode
  /** Callback quand l'utilisateur clique "Ajouter" depuis CatalogCharacters
   *  avec un perso sélectionné + un prompt de placement. */
  onAddCharacter?: (character: Character, placementPrompt: string) => Promise<void> | void
  /** Callback breadcrumb : remonter d'une vue sub-bank (Personnages, Objets…)
   *  vers la racine Banques. */
  onNavigateToBanks?: () => void
}

export default function DesignerCatalog({
  category, onClose, storagePathPrefix,
  personnageMode = null, onAddCharacter, onNavigateToBanks,
}: DesignerCatalogProps) {
  switch (category) {
    case 'effects':
      return <CatalogEffects onClose={onClose} />

    case 'edit':
      return <CatalogEdit onClose={onClose} storagePathPrefix={storagePathPrefix} />

    case 'banks':
      return (
        <CatalogPlaceholder
          title="🖼 Banques"
          onClose={onClose}
          description="Parcours et place des éléments visuels existants : personnages, objets, lieux génériques, sprites extraits."
          upcoming={[
            'Images générées dans ce projet',
            'NPCs génériques (catalogue partagé)',
            'Objets génériques (catalogue partagé)',
            'Sprites extraits (par découpe SAM)',
            'Lieux & décors',
          ]}
        />
      )

    case 'generate':
      // Routing fin selon le sub-tool Personnage actif. Les autres modes
      // (replace/modify/animate) ne sont pas encore branchés — placeholder.
      // 'add' et 'modify' partagent le même catalog (Banque Personnages).
      // En mode 'add' : bouton "Ajouter à la scène" actif. En mode 'modify' :
      // l'auteur clique le crayon de chaque card pour éditer le perso.
      if (personnageMode === 'add' || personnageMode === 'modify') {
        return (
          <CatalogCharacters
            onClose={onClose}
            onAdd={onAddCharacter}
            onNavigateToBanks={onNavigateToBanks}
            storagePathPrefix={storagePathPrefix}
          />
        )
      }
      if (personnageMode === 'animate') {
        return (
          <CatalogAnimation
            onClose={onClose}
            onNavigateToBanks={onNavigateToBanks}
            storagePathPrefix={storagePathPrefix}
          />
        )
      }
      return (
        <CatalogPlaceholder
          title="✨ Génération AI"
          onClose={onClose}
          description="Lance des générations AI pour enrichir ce plan : variations, inpainting, panorama 360°, vidéo Wan, etc."
          upcoming={[
            'Régénérer la base (modifier prompt / style)',
            'Variation de la base (alternative à preview)',
            'Inpainting (réécrire une zone)',
            'Erase (effacer un élément)',
            'Pano 360° (transformer en immersif)',
            'Vidéo Wan / Motion Brush',
          ]}
        />
      )

    case 'animations':
      return (
        <CatalogPlaceholder
          title="🎬 Animations"
          onClose={onClose}
          description="Anime les éléments du plan : Lottie design, timelines GSAP, parallax, transitions."
          upcoming={[
            'Animations Lottie (sigils, magic, level-up, sparkle)',
            'Timelines GSAP (combat hit, reveal text, stagger cartes)',
            'Parallax 3D (Atropos)',
            'Transitions de section',
            'Reveal text (typed.js, splitting)',
          ]}
        />
      )

    case 'annotations':
      return (
        <CatalogPlaceholder
          title="📝 Annotations narratives"
          onClose={onClose}
          description="Place des marqueurs visuels pour les choix et conversations créés dans Studio Creator. Le Designer fait uniquement le placement, pas la création."
          upcoming={[
            'Choix non placés (depuis Creator)',
            'Conversations non placées',
            'Choix déjà placés (avec navigation rapide)',
            'Bouton « Créer un choix rapidement » (anti-friction)',
          ]}
        />
      )

    case 'audio':
      return (
        <CatalogPlaceholder
          title="🔊 Sons & musiques"
          onClose={onClose}
          description="Ajoute des sons au calque actif. 3 sources : banque pré-curée, tes propres uploads, génération AI (ElevenLabs)."
          upcoming={[
            'Onglet « Banque » (sons pré-curés par catégorie)',
            'Onglet « Mes sons » (uploads + sons IA mémorisés)',
            'Onglet « Générer IA » (description texte → son)',
            'Mixer audio (timeline par calque) en bottom drawer',
          ]}
        />
      )

    default:
      return null
  }
}
