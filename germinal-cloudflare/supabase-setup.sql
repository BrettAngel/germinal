-- Run this in your Supabase SQL editor at supabase.com
-- Project > SQL Editor > New Query > paste this > Run

CREATE TABLE IF NOT EXISTS canvas_states (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id      TEXT UNIQUE NOT NULL,
  theme         TEXT NOT NULL DEFAULT 'love',
  generation    INTEGER NOT NULL DEFAULT 1,
  parent_id     TEXT,
  depth         INTEGER NOT NULL DEFAULT 0,
  cell_data     TEXT NOT NULL,
  stab_map      TEXT,
  contributor_id TEXT,
  affinity_score FLOAT DEFAULT 0,
  view_count    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mother_display (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme             TEXT UNIQUE NOT NULL,
  generation        INTEGER NOT NULL DEFAULT 1,
  cell_data         TEXT NOT NULL,
  contributor_count INTEGER DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Allow public read access to canvas states and mother display
ALTER TABLE canvas_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE mother_display ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON canvas_states FOR SELECT USING (true);
CREATE POLICY "Public insert" ON canvas_states FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read mother" ON mother_display FOR SELECT USING (true);
CREATE POLICY "Public upsert mother" ON mother_display FOR ALL USING (true);
