-- EARNest durable store — run once in the Supabase SQL editor.
CREATE TABLE IF NOT EXISTS app_tables (
  name TEXT PRIMARY KEY,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS video_clips (
  id TEXT PRIMARY KEY,
  data TEXT,
  bytes INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_clips ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_tables_anon_all ON app_tables FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY video_clips_anon_all ON video_clips FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_tables TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON video_clips TO anon;
