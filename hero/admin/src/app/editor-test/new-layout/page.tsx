/**
 * /editor-test/new-layout — Studio Designer V2 (refonte 2026-05-27).
 *
 * Cette route servait historiquement la V1 du Studio Designer. Depuis le
 * 2026-05-27, elle re-exporte directement le composant de V2 :
 *   src/app/editor-test/new-layout-v2/page.tsx
 *
 * Pourquoi un re-export plutôt qu'un renommage ?
 *   - Garde les imports relatifs des composants V2 vers `./DevStudioPicker`
 *     et `./SceneTestPicker` (qui restent dans ce dossier) sans modification.
 *   - Aucun caller externe n'est cassé (router.push('/editor-test/new-layout')
 *     continue de fonctionner).
 *   - Sauvegarde de l'ancienne V1 dans `../new-layout-legacy/page.tsx` pour
 *     pouvoir y revenir si nécessaire (cf demande user 2026-05-27 :
 *     "remplacer la V1 par la V2, garder la V1 en fichier").
 */
// Doit etre exporte ici aussi (Next ne propage pas la config
// dynamic via un re-export d un autre segment).
export const dynamic = 'force-dynamic'

export { default } from '../new-layout-v2/PageClient'
