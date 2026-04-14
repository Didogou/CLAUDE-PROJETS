-- Point de départ de la piste musicale d'une section (en secondes)
ALTER TABLE sections ADD COLUMN IF NOT EXISTS music_start_time REAL;
