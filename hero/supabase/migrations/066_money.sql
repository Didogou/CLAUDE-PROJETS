-- Money system: sections can loot money, choices can cost money
ALTER TABLE sections ADD COLUMN IF NOT EXISTS money_loot integer DEFAULT NULL;
ALTER TABLE choices ADD COLUMN IF NOT EXISTS money_cost integer DEFAULT NULL;
