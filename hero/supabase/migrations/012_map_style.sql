-- Remplace map_type (none|fog|found|known) par :
--   map_style    : null = pas de carte, sinon style visuel (subway|city|dungeon|forest|sea)
--   map_visibility : full|found|fog  (mécanique de révélation pour le joueur)

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS map_style      text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS map_visibility text DEFAULT 'full';

-- Migration des données existantes
UPDATE books SET
  map_style = CASE
    WHEN map_type = 'none'  THEN NULL
    WHEN map_type = 'fog'   THEN 'city'
    WHEN map_type = 'found' THEN 'city'
    WHEN map_type = 'known' THEN 'subway'
    ELSE NULL
  END,
  map_visibility = CASE
    WHEN map_type = 'fog'   THEN 'fog'
    WHEN map_type = 'found' THEN 'found'
    ELSE 'full'
  END
WHERE map_type IS NOT NULL;

-- On garde map_type pour compatibilité descendante (pas de DROP pour l'instant)
