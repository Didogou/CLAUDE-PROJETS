-- Phrases d'encouragement affichees sur /mes-calories selon l'etat
-- d'avancement de l'utilisatrice (debut-journee / bonne-route /
-- objectif-atteint). Editees par Karine via /admin/parametres.
-- Stocke en JSONB pour souplesse : on peut ajouter des categories
-- ou champs sans changer le schema.

alter table public.app_settings
  add column if not exists calorie_encouragements jsonb;

-- Valeur initiale : fallback hardcode du code (3 categories x 3 phrases).
update public.app_settings
set calorie_encouragements = '{
  "debut-journee": [
    "Chaque petit choix compte, soyez fière de vous ♡",
    "Une journée commence bien quand on prend soin de soi ♡",
    "Petit à petit, vous y arrivez ♡"
  ],
  "bonne-route": [
    "Continuez sur votre lancée, c''est top ♡",
    "Vous avancez bien, restez à l''écoute de votre corps ♡",
    "Belle régularité, c''est ça qui fait la différence ♡"
  ],
  "objectif-atteint": [
    "Objectif atteint, soyez fière de vous ♡",
    "Bravo ! Vous avez écouté votre corps aujourd''hui ♡",
    "Magnifique journée nutrition, félicitations ♡"
  ]
}'::jsonb
where calorie_encouragements is null;
