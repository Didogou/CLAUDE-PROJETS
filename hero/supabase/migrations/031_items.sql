CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name text NOT NULL,
  item_type text NOT NULL DEFAULT 'outil',
  description text,
  illustration_url text,
  section_found_id uuid REFERENCES sections(id) ON DELETE SET NULL,
  sections_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  effect jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_book_id_idx ON items(book_id);
