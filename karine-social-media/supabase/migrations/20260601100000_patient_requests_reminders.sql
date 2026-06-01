-- Extensions sur patient_requests :
-- - reminder_count : nombre de fois où la patiente a relancé sa demande
--   pending (gérée côté API : doublon → incrément + notif Karine au lieu
--   de nouvelle ligne)
-- - reviewer_comment : message libre que Karine peut écrire en validant
--   ou refusant. Affiché à la patiente dans l'email envoyé.

alter table public.patient_requests
  add column if not exists reminder_count integer not null default 0;

alter table public.patient_requests
  add column if not exists reviewer_comment text;

-- On retire l'unique (user_id, status) ajouté en V1 : une même patiente peut
-- avoir plusieurs lignes au fil du temps (ex. rejected → re-demande approuvée).
alter table public.patient_requests
  drop constraint if exists patient_requests_user_id_status_key;

create index if not exists patient_requests_user_id_status_created_idx
  on public.patient_requests(user_id, status, created_at desc);
