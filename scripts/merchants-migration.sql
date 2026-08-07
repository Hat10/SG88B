-- ── merchants table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchants (
  key      text PRIMARY KEY,
  name     text NOT NULL,
  category text NOT NULL DEFAULT 'annet'
);

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='merchants' AND policyname='public read') THEN
    CREATE POLICY "public read"  ON merchants FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='merchants' AND policyname='public write') THEN
    CREATE POLICY "public write" ON merchants FOR ALL    USING (true);
  END IF;
END $$;

-- ── Migrate existing rules ──────────────────────────────────────────────────
INSERT INTO merchants (key, name, category)
SELECT
  merchant,
  COALESCE(NULLIF(trim(label), ''), merchant),
  category
FROM merchant_rules
ON CONFLICT (key) DO UPDATE
  SET name     = EXCLUDED.name,
      category = EXCLUDED.category;
