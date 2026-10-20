-- ════════════════════════════════════════════════════════════════════════
-- Germinal: PREVIEW-ONLY migration for anonymous "Dream it" onboarding
-- events (variant B / PR #6).
--
-- STATUS: APPROVED BY BRETT (Oct 2026) and being applied to the PREVIEW
-- Supabase project (klzynejvehyzdimzzkjv) only. Never run it on production.
-- Collection also needs DREAM_EVENTS_ENABLED=1 (or true) in the Cloudflare
-- Pages PREVIEW env; the client (dream-ui.js) only sends from *.pages.dev.
-- Visitors' own localStorage (germ_dream_log / germ_dream_stats) is kept too.
--
-- Privacy: privacy.html ("Preview test versions") says that preview
-- versions may record this summary and germinal.studio doesn't. Each row is one anonymous session
-- summary, with no IP, no user agent, no contributor id, no cookie id and
-- no canvas content. `day` is a date, not a timestamp.
-- Security: same as preview-setup.sql. RLS on, no policies, and
-- anon/authenticated revoked. Only the Functions' service key writes.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dream_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day             DATE    NOT NULL DEFAULT CURRENT_DATE,
  v               SMALLINT NOT NULL DEFAULT 1,           -- record version
  variant         TEXT    NOT NULL CHECK (char_length(variant) <= 16),
  hint            TEXT    NOT NULL CHECK (char_length(hint) <= 24),
  kiosk           BOOLEAN NOT NULL DEFAULT false,
  reduced_motion  BOOLEAN NOT NULL DEFAULT false,
  is_returning    BOOLEAN NOT NULL DEFAULT false,         -- ("returning" is reserved in Postgres)
  dream           TEXT    NOT NULL CHECK (dream IN ('none','playing','completed','skipped','interrupted','preempted')),
  dream_ms        INTEGER CHECK (dream_ms BETWEEN 0 AND 600000),
  replays         SMALLINT NOT NULL DEFAULT 0 CHECK (replays BETWEEN 0 AND 1000),
  first_lasso_ms  INTEGER CHECK (first_lasso_ms BETWEEN 0 AND 86400000),
  lasso_within_30s BOOLEAN NOT NULL DEFAULT false,
  lassos          SMALLINT NOT NULL DEFAULT 0 CHECK (lassos BETWEEN 0 AND 10000),
  evolved         BOOLEAN NOT NULL DEFAULT false,
  shared          BOOLEAN NOT NULL DEFAULT false,
  used_technique  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS dream_events_day_idx ON public.dream_events (day);

ALTER TABLE public.dream_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dream_events FROM anon, authenticated;

-- Example read-out (SQL editor):
-- SELECT day, count(*) sessions,
--        avg((dream='completed')::int) completed,
--        avg(lasso_within_30s::int)  lasso30,
--        avg(used_technique::int)    adoption
--   FROM public.dream_events GROUP BY day ORDER BY day DESC;
