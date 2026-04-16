-- Add portrait_settings JSONB column to npcs table
-- Stores ComfyUI generation parameters: prompt_fr, prompt_en, negative, steps, cfg, seed, checkpoint, style
ALTER TABLE npcs ADD COLUMN IF NOT EXISTS portrait_settings jsonb DEFAULT NULL;
