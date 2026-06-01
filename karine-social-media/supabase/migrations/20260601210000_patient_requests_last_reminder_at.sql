-- Ajoute last_reminder_at pour gérer le cooldown entre relances.
-- Au moment d'une relance, on met cette colonne à now() côté API. Le calcul
-- du cooldown se fait sur max(created_at, last_reminder_at).

alter table public.patient_requests
  add column if not exists last_reminder_at timestamptz;
