-- ════════════════════════════════════════════════════════════════════════
-- Germinal — PREVIEW database setup (spare Supabase project
-- klzynejvehyzdimzzkjv). NOT for the production project.
--
-- Run once in that project's SQL Editor (see supabase/PREVIEW-DB.md).
-- Idempotent: safe to run again.
--
-- Tables match production as supabase-setup.sql defines it, plus what the
-- code reads and writes:
--   canvas_states : short_id, theme, generation, parent_id, depth, cell_data,
--                   stab_map, contributor_id, view_count, created_at
--                   (affinity_score is in production's schema, unused by code)
--   mother_display: theme, generation, cell_data, contributor_count, updated_at
--
-- Security: RLS on, and NO policies at all. The Cloudflare Pages Functions
-- use the service_role key, which bypasses RLS. The browser never talks to
-- Supabase directly (see privacy.html), so anon/authenticated need no access:
-- table privileges are revoked from them as well. (Production, by contrast,
-- still has "Public insert"/"Public upsert" policies; see PR #2 follow-ups.)
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() (built in on PG13+, harmless)

CREATE TABLE IF NOT EXISTS public.canvas_states (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_id       TEXT UNIQUE NOT NULL,           -- unique index comes with UNIQUE
  theme          TEXT NOT NULL DEFAULT 'love',
  generation     INTEGER NOT NULL DEFAULT 1,
  parent_id      TEXT,
  depth          INTEGER NOT NULL DEFAULT 0,
  cell_data      TEXT NOT NULL,                  -- base64, 1,584,000 chars
  stab_map       TEXT,                           -- variant B: 1-bit "chosen this session" map (99,000 chars)
  contributor_id TEXT,
  affinity_score FLOAT DEFAULT 0,
  view_count     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.mother_display (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme             TEXT UNIQUE NOT NULL,        -- one live canvas per (namespaced) theme
  generation        INTEGER NOT NULL DEFAULT 1,  -- also the optimistic-concurrency token for merges
  cell_data         TEXT NOT NULL,
  contributor_count INTEGER DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ─────────────────────────────────────────────────────────────
-- short_id: unique index already created by the UNIQUE constraint above;
-- this guarantees it even if the table pre-existed without the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS canvas_states_short_id_key   ON public.canvas_states (short_id);
-- theme (+ created_at, for display-live's "newest canvas for a theme" fallback
-- and its count; still serves plain theme lookups).
CREATE INDEX        IF NOT EXISTS canvas_states_theme_created_idx ON public.canvas_states (theme, created_at DESC);
-- lineage lookups (children of a canvas)
CREATE INDEX        IF NOT EXISTS canvas_states_parent_id_idx  ON public.canvas_states (parent_id);

-- ── Row Level Security: on, no policies → anon/authenticated get nothing ──
ALTER TABLE public.canvas_states  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mother_display ENABLE ROW LEVEL SECURITY;

-- In case production's setup script was ever run here by mistake:
DROP POLICY IF EXISTS "Public read"          ON public.canvas_states;
DROP POLICY IF EXISTS "Public insert"        ON public.canvas_states;
DROP POLICY IF EXISTS "Public read mother"   ON public.mother_display;
DROP POLICY IF EXISTS "Public upsert mother" ON public.mother_display;

-- Belt and braces: no table privileges for the public API roles either.
REVOKE ALL ON public.canvas_states  FROM anon, authenticated;
REVOKE ALL ON public.mother_display FROM anon, authenticated;
-- The server role keeps full access (Supabase grants this by default; explicit here).
GRANT ALL ON public.canvas_states  TO service_role;
GRANT ALL ON public.mother_display TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- OPTIONAL — NOT NEEDED FOR PR #6. Only for a later, sim-faithful version
-- that stores hold LEVELS (1–3) on the live canvas, so a release drops one
-- level at a time like the simulation. Requires code changes in
-- functions/api/canvas-save.js + lib/merge.js to read/write it. Leave
-- commented out unless that code exists.
-- ════════════════════════════════════════════════════════════════════════
-- ALTER TABLE public.mother_display
--   ADD COLUMN IF NOT EXISTS stab_map TEXT;     -- base64, 2 bits per cell (hold level 0–3): 594,000 cells → 148,500 bytes → 198,000 chars
-- COMMENT ON COLUMN public.mother_display.stab_map IS
--   'Hold level per cell, 2 bits (0 free, 1 held, 2 refined, 3 crystallised), base64. Optional; prototype only.';
