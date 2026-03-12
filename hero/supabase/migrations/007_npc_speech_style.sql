-- Migration 007: speech_style for NPCs + dialogue trial type support
-- speech_style: how the NPC speaks (accent, vocabulary, mannerisms)
ALTER TABLE npcs ADD COLUMN IF NOT EXISTS speech_style text;

-- dialogue_intro: optional narrator text shown before the dialogue starts
ALTER TABLE npcs ADD COLUMN IF NOT EXISTS dialogue_intro text;
