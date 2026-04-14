-- Ajoute le texte narratif ennemi sur les moves de combat
-- narrative_text = version joueur ("Tu balances un direct")
-- narrative_text_npc = version ennemi ("Il fonce sur toi et te percute")

ALTER TABLE combat_moves
  ADD COLUMN IF NOT EXISTS narrative_text_npc TEXT;
