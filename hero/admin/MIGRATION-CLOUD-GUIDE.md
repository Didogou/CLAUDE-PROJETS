# Guide migration cloud V2 — 2026-05-14

Procédure pour migrer la banque assets V2 (migrations 082→085 + data) sur la prod Supabase cloud.

**À lire entièrement avant exécution. Ne pas sauter d'étape.**

## Pré-requis

- [ ] `.env.local.cloud` à jour avec les bons creds prod (`NEXT_PUBLIC_SUPABASE_URL` cloud + `SUPABASE_SERVICE_ROLE_KEY` cloud)
- [ ] Accès au dashboard Supabase prod (SQL editor)
- [ ] Accès au dashboard pour gérer les backups
- [ ] `pg_dump` installé localement (vérifier `pg_dump --version`) — fallback en cas de problème dashboard

## Étape 1 — Backup

**Obligatoire avant de toucher à la prod.**

Option A — Via dashboard Supabase :
1. Dashboard prod → Database → Backups
2. Click "Create new backup" (selon ton plan, peut-être pas dispo)

Option B — Via `pg_dump` (toujours possible) :
```bash
# Récupère la connection string depuis dashboard → Settings → Database → Connection string (Direct)
# Format : postgresql://postgres.[ref]:[password]@aws-0-...supabase.com:5432/postgres
PGPASSWORD='<password>' pg_dump 'postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' > backup-pre-v2-$(date +%Y%m%d-%H%M%S).sql
```

**Garde le fichier `.sql` à un endroit sûr. Si quelque chose va mal, c'est ton seul filet.**

## Étape 2 — Run les 4 migrations SQL

Via dashboard prod → **SQL editor** → New query.

Pour chaque migration **dans l'ordre** :
- `082_assets_bank_v2.sql`
- `083_indexes_assets_v2.sql`
- `084_assets_v2_rpc.sql`
- `085_assets_image_layers.sql`

Procédure par fichier :
1. Ouvre le fichier dans `hero/supabase/migrations/`
2. Copie-colle tout son contenu dans le SQL editor
3. Run
4. Vérifie le retour : `BEGIN, CREATE TABLE/FUNCTION, COMMIT` (selon le fichier)
5. Si erreur → STOP, regarde le message, ne passe pas à la suivante

**Vérification après les 4** :
```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'assets%' OR tablename IN ('asset_usage','section_timeline');
-- Doit retourner : assets_image, assets_animation, assets_audio, assets_text, asset_usage, section_timeline

SELECT proname FROM pg_proc WHERE proname IN ('delete_asset_scoped','delete_asset_global','cleanup_orphan_assets');
-- Doit retourner les 3 fonctions
```

## Étape 3 — Run la migration des données

**Switch ton .env.local vers cloud temporairement** :
```bash
cd hero/admin
cp .env.local .env.local.backup-during-migration  # safety
cp .env.local.cloud .env.local
```

**Lance le script en mode `--no-wipe`** (= n'écrase pas si jamais des rows V2 existent déjà) :
```bash
node scripts/migrate-section-images-to-assets.mjs --no-wipe
```

Le script va :
1. Skip wipe (`--no-wipe`)
2. Fetch toutes les sections du livre
3. Décomposer chaque `section.images[]` JSONB en rows V2 (assets_* + asset_usage + section_timeline)
4. Afficher les stats finales

**Restaure ton .env.local local** :
```bash
cp .env.local.backup-during-migration .env.local
rm .env.local.backup-during-migration
```

## Étape 4 — Vérification

Via SQL editor cloud :
```sql
-- Combien d'assets par type ?
SELECT 'image' AS t, count(*) FROM assets_image
UNION ALL SELECT 'animation', count(*) FROM assets_animation
UNION ALL SELECT 'audio', count(*) FROM assets_audio
UNION ALL SELECT 'text', count(*) FROM assets_text;

-- Combien de blocs timeline + usages ?
SELECT 'timeline' AS t, count(*) FROM section_timeline
UNION ALL SELECT 'usage', count(*) FROM asset_usage;
```

Compare avec le compte attendu : 1 row asset par image legacy, 1 row timeline par image legacy, 1 row usage par section qui référence chaque asset.

**Test fonctionnel** :
1. Configure ton `.env.local.cloud` une dernière fois pour tester (uniquement) :
   ```bash
   cp .env.local.cloud .env.local
   npm run dev
   ```
2. Ouvre `http://localhost:3000/editor-test/studio-creator/[bookId]` — vérifie que les thumbs s'affichent
3. Click sur une section → ouvre Designer → vérifie que tu vois ton image
4. Restaure `.env.local` local après test :
   ```bash
   cp .env.local.local .env.local
   ```

## Étape 5 — Rollback (si nécessaire)

Si quelque chose casse en prod :

Option A — Restore via dashboard si backup créé :
- Dashboard → Backups → Restore selected

Option B — Restore via `pg_restore` :
```bash
psql 'postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' < backup-pre-v2-YYYYMMDD-HHMMSS.sql
```

Option C — Drop seulement les nouvelles tables (garde les data legacy intactes) :
```sql
BEGIN;
DROP TABLE IF EXISTS public.section_timeline CASCADE;
DROP TABLE IF EXISTS public.asset_usage CASCADE;
DROP TABLE IF EXISTS public.assets_image CASCADE;
DROP TABLE IF EXISTS public.assets_animation CASCADE;
DROP TABLE IF EXISTS public.assets_audio CASCADE;
DROP TABLE IF EXISTS public.assets_text CASCADE;
DROP FUNCTION IF EXISTS public.delete_asset_scoped CASCADE;
DROP FUNCTION IF EXISTS public.delete_asset_global CASCADE;
DROP FUNCTION IF EXISTS public.cleanup_orphan_assets CASCADE;
COMMIT;
```

Les colonnes legacy (`sections.images` JSONB) ne sont pas touchées par V2 → l'app retombe sur le flow legacy automatiquement.

## Phase 7 (post-migration validée)

Après quelques jours en prod sans bug, on pourra **déprécier** la colonne `sections.images` JSONB (= migration séparée pour `DROP COLUMN`). Pas avant : c'est notre filet de sécurité.
