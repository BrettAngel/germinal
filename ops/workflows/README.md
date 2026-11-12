# GitHub Actions workflows

The workflow files now live in `.github/workflows/`.

- `wall-tick.yml`: the server-side live wall, a tick every 10 minutes
  (`tools/wall-tick.mjs`). Needs repo secrets `PREVIEW_SUPABASE_URL` and
  `PREVIEW_SUPABASE_SERVICE_KEY`. You can also run it by hand from the Actions tab.
- `keepalive.yml`: the Supabase keep-awake job, **preview-only for now** — it
  pings `https://live-wall-compositor.germinal.pages.dev/api/display-live?theme=love`,
  not production.

GitHub runs scheduled (cron) workflows only from the default branch, so both
crons start once they're on `main`.
