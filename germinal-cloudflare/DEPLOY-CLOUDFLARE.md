# Germinal — Cloudflare Pages Deployment

Your files are already in GitHub. These steps connect Cloudflare to that
repo, deploy everything (including the serverless functions), and move
your domain. All doable from any browser, including iPhone.

────────────────────────────────────────────────────────
STEP 1 — Commit these updated files to GitHub
────────────────────────────────────────────────────────
This package has a NEW structure for Cloudflare. Upload ALL of it to your
existing `germinal` repo, replacing the old files:

  index.html, app.html, live.html, intro.html
  intro-voice.m4a
  supabase-setup.sql
  _redirects
  package.json
  functions/  (folder — contains api/canvas-save.js,
               api/canvas-load/[id].js, api/display-live.js)

IMPORTANT: the old `netlify/` folder and `netlify.toml` are GONE on purpose.
If your repo still has them, delete them (they're harmless but unnecessary).

On a Mac: github.com/USERNAME/germinal/upload/main → drag the folder
contents in → Commit changes. Confirm the `functions/api` folder is intact.

────────────────────────────────────────────────────────
STEP 2 — Create a free Cloudflare account
────────────────────────────────────────────────────────
1. Go to dash.cloudflare.com/sign-up
2. Sign up free (no card required)
3. Verify your email

────────────────────────────────────────────────────────
STEP 3 — Connect the GitHub repo
────────────────────────────────────────────────────────
1. In the Cloudflare dashboard, left sidebar → "Workers & Pages"
2. Click "Create" → "Pages" tab → "Connect to Git"
3. Authorise Cloudflare to access your GitHub (one-time)
4. Select the `germinal` repository
5. Build settings:
     - Framework preset:  None
     - Build command:     (leave EMPTY)
     - Build output dir:  /  (just a forward slash, or leave as ".")
   (Germinal is plain HTML — no build step needed. Cloudflare detects the
    functions/ folder automatically.)
6. Click "Save and Deploy"

It builds in ~1 minute and gives you a URL like germinal-xyz.pages.dev

────────────────────────────────────────────────────────
STEP 4 — Add your Supabase secrets
────────────────────────────────────────────────────────
1. In your new Pages project → Settings → Environment variables
2. Add two variables (Production):
     SUPABASE_URL         = your Supabase project URL
     SUPABASE_SERVICE_KEY = your Supabase secret (service_role) key
3. Mark SUPABASE_SERVICE_KEY as a secret / "Encrypt" if offered
4. Re-deploy: Deployments → latest → "Retry deployment"
   (so the functions pick up the new variables)

TEST: open  https://germinal-xyz.pages.dev/api/canvas-load/test
You should see  {"error":"Canvas not found"}  — that means functions work.

────────────────────────────────────────────────────────
STEP 5 — Move the domain germinal.studio
────────────────────────────────────────────────────────
1. In your Pages project → Custom domains → "Set up a custom domain"
2. Enter germinal.studio → Continue
3. Cloudflare will tell you how to point the domain. Two cases:

   A) If germinal.studio is registered somewhere that lets you change
      nameservers (most registrars): Cloudflare may invite you to move
      the whole domain to Cloudflare (free). Follow its prompts — it
      gives you two nameservers to paste at your registrar.

   B) Simpler if you don't want to move nameservers: add the CNAME / A
      records Cloudflare shows you at your current DNS provider.

   Cloudflare shows the exact values; copy them precisely.

4. Wait for DNS to propagate (minutes to a couple of hours). SSL is
   automatic and free.

NOTE: while the domain points to Cloudflare, remove the domain from the
old Netlify site to avoid a conflict (Netlify → domain settings → remove).

────────────────────────────────────────────────────────
DONE
────────────────────────────────────────────────────────
After this: every push to GitHub auto-deploys, free, with no credit meter.
Sharing preserves the canvas. The live display works at /live.
