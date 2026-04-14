-- Colonnes manquantes sur la table items (générées par generate-sections)
ALTER TABLE items ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'consommable';
ALTER TABLE items ADD COLUMN IF NOT EXISTS weapon_type text;
ALTER TABLE items ADD COLUMN IF NOT EXISTS radio_broadcasts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE items ADD COLUMN IF NOT EXISTS use_section_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE items ADD COLUMN IF NOT EXISTS pickup_section_numbers jsonb NOT NULL DEFAULT '[]'::jsonb;
