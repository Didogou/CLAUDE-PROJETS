-- 010_locations.sql
-- Carte des lieux par livre

-- Type de carte sur chaque livre
ALTER TABLE books ADD COLUMN IF NOT EXISTS map_type text NOT NULL DEFAULT 'none'
  CHECK (map_type IN ('none', 'fog', 'found', 'known'));

-- Table des lieux uniques
CREATE TABLE IF NOT EXISTS locations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id    uuid        NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  x          integer     NOT NULL DEFAULT 50 CHECK (x >= 0 AND x <= 100),
  y          integer     NOT NULL DEFAULT 50 CHECK (y >= 0 AND y <= 100),
  icon       text        NOT NULL DEFAULT '📍',
  created_at timestamptz DEFAULT now()
);

-- Lien section → lieu
ALTER TABLE sections ADD COLUMN IF NOT EXISTS location_id uuid
  REFERENCES locations(id) ON DELETE SET NULL;
