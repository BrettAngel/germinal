# Preview database (spare Supabase project)

**Goal:** give Cloudflare Pages *preview* deployments (PR branches such as
`variant-b-crowd`) their own throwaway database, so Share/merge can be tested
on previews **without production keys anywhere near them**. Production
(germinal.studio and its Supabase project) is not touched by any step here.

Spare project: **`klzynejvehyzdimzzkjv`** (currently paused).

## 1. Unpause the spare project
1. Go to <https://supabase.com/dashboard/project/klzynejvehyzdimzzkjv>.
2. Click **Resume project** / **Restore** and confirm. It takes a few minutes.
3. Free plan: only **2 projects can be active at once**. If resuming is
   blocked, another free project (not production!) has to be paused first.

## 2. Run the setup SQL
1. In the spare project: **SQL Editor → New query**.
2. Paste the contents of [`supabase/preview-setup.sql`](preview-setup.sql) and click **Run**.
3. Check it with **Table Editor**: `canvas_states` and `mother_display` exist and are empty,
   and **Authentication → Policies** shows RLS *enabled* with *no policies* on both.
   That's intended: only the server (service key) can read/write.

The script is idempotent; running it twice is fine. Leave the "OPTIONAL"
block at the bottom commented out.

## 3. Get the URL and service key (spare project only)
In the spare project: **Project Settings → API** (in newer dashboards: **Project
Settings → Data API** for the URL and **API Keys** for keys):
- **Project URL**, i.e. `https://klzynejvehyzdimzzkjv.supabase.co` → `SUPABASE_URL`
- **service_role** secret key (newer dashboards: a **secret** key, `sb_secret_…`) → `SUPABASE_SERVICE_KEY`

Double-check the project ref in the URL is `klzynejvehyzdimzzkjv` before copying.
Never use the production project's values here.

## 4. Add them to the Cloudflare Pages **Preview** environment only
1. Cloudflare dashboard → **Workers & Pages → germinal → Settings → Variables and Secrets**
   (older UI: *Environment variables*).
2. Switch the environment selector to **Preview**, not Production.
3. Add:
   - `SUPABASE_URL` = `https://klzynejvehyzdimzzkjv.supabase.co`
   - `SUPABASE_SERVICE_KEY` = the spare project's service/secret key, type **Secret (encrypt)**
4. Save. Leave the **Production** variables exactly as they are.
5. Redeploy the preview so it picks the variables up: push a commit to the
   branch, or **Deployments → (latest variant-b-crowd preview) → … → Retry deployment**.

### What this means
- **Every** preview deployment of this repo (all PR branches, now and later) will
  read and write the **spare** database. None of them will reach production.
- Production keeps using the production project; nothing about germinal.studio changes.
- Data in the spare project is test data: it can be wiped any time with
  `TRUNCATE public.canvas_states, public.mother_display;`.
- PR #6 additionally namespaces everything to `pb-…` themes, so its rows are easy to spot.

## 5. Verify
Replace `PREVIEW` with the branch preview, e.g. `https://variant-b-crowd.germinal.pages.dev`.

```bash
# 1) The API can reach the spare DB: expect 200 and {"theme":"pb-love-attractors","empty":true,...}
#    (before this setup it returned 503 "Server not configured").
curl -s "PREVIEW/api/display-live?theme=pb-love-attractors"

# 2) Test save: open PREVIEW/app.html in a browser, skip the intro, lasso
#    something, press Evolve, then Share. The toast should say
#    "Your canvas is now the live canvas".
# 3) Read it back: expect "generation":1, "contributorCount":1, "source":"mother_display".
curl -s "PREVIEW/api/display-live?theme=pb-love-attractors" | head -c 300; echo
```

In the spare project's Table Editor you should then see one `mother_display`
row with theme `pb-love-attractors` and one `canvas_states` row.

Confirm production didn't change (same numbers as before the test):
```bash
curl -s "https://www.germinal.studio/api/display-live?theme=love" | head -c 300; echo
```

## 6. Auto-pause and keepalive
- **Yes, it will pause again.** Supabase pauses Free-plan projects after about
  **7 days of low database activity**, and sends a warning email first. A paused
  project can be resumed from the dashboard for up to a year, then step 1 again.
  Previews will return errors (500, "fetch failed") while it is paused.
- **Keepalive option:** the repo's keepalive workflow pings
  `/api/canvas-load/keepalive`, which runs one harmless DB query. Adding a second
  ping to a **preview** URL would keep the spare project awake too, e.g.
  ```yaml
          curl -sS -o /dev/null -w "HTTP %{http_code}\n" \
            "https://variant-b-crowd.germinal.pages.dev/api/canvas-load/keepalive" || true
  ```
  Caveats:
  1. The workflow file is currently at `forkflows/keepalive.yml`, **not**
     `.github/workflows/`, so GitHub doesn't run it at all right now, for
     production either. It has to move to `.github/workflows/keepalive.yml` to run.
  2. A branch alias like `variant-b-crowd.germinal.pages.dev` only exists while
     that branch exists. Point the ping at whichever preview branch you keep.
  3. Supabase says "a few requests each day" is typically enough. Twice a week
     (the current cron) may be borderline; a daily cron (`'0 9 * * *'`) is safer.
- Or just let it pause between test sessions and resume it when needed. It's test data.
