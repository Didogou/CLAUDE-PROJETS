-- Contrainte unique (book_id, name) sur npcs pour éviter les doublons
-- Supprimer d'abord les doublons existants (garder le plus récent)
DELETE FROM npcs
WHERE id NOT IN (
  SELECT DISTINCT ON (book_id, lower(name)) id
  FROM npcs
  ORDER BY book_id, lower(name), created_at DESC
);

-- Ajouter la contrainte unique (insensible à la casse via index)
CREATE UNIQUE INDEX IF NOT EXISTS npcs_book_id_name_unique
  ON npcs (book_id, lower(name));
