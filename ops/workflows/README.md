# GitHub Actions workflows waiting to be installed

These belong in `.github/workflows/`. The bot's GitHub token can't create or
change workflow files (it doesn't have the `workflow` scope), so they're parked
here. Brett: move both files into `.github/workflows/` (in the GitHub web
editor, or `git mv ops/workflows/*.yml .github/workflows/`), then merge.

- `wall-tick.yml`: the server-side live wall, a tick every 10 minutes
  (`tools/wall-tick.mjs`). Needs repo secrets `PREVIEW_SUPABASE_URL` and
  `PREVIEW_SUPABASE_SERVICE_KEY`. You can also run it by hand from the Actions tab.
- `keepalive.yml`: the Supabase keep-awake job. It used to be in `forkflows/`,
  where GitHub never ran it.

GitHub runs scheduled (cron) workflows only from the default branch, so both
crons start once they're on `main`.
