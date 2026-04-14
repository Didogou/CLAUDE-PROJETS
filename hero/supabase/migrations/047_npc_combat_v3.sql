-- Combat V3 (QCM cinématique) : images de combat stockées en JSONB
-- Structure : { neutral_url, hit_url, dodge_url, ko_url, attack_urls: { "Coup haut": "url..." } }

ALTER TABLE npcs
  ADD COLUMN IF NOT EXISTS combat_v3 JSONB;
