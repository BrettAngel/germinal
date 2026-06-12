# Germinal — Deployment Instructions
## Three steps. ~15 minutes. No developer needed.

---

## Step 1: Create Supabase database (5 minutes)

1. Go to supabase.com → Sign up free (use Google login)
2. Click "New Project" → name it "germinal" → choose a region → Create
3. Wait ~2 minutes for project to be ready
4. Click "SQL Editor" in the left sidebar
5. Click "New Query"
6. Copy and paste the contents of `supabase-setup.sql` into the editor
7. Click "Run" → you should see "Success"
8. Go to Settings > API → copy two values:
   - "Project URL" (looks like https://xxxxx.supabase.co)
   - "service_role" key (under "Project API keys")
   Keep these — you'll need them in Step 3.

---

## Step 2: Deploy to Netlify (5 minutes)

1. Go to app.netlify.com → log in (or sign up free)
2. Click "Add new site" → "Deploy manually"
3. Drag THIS ENTIRE FOLDER onto the drop zone
   (the folder containing app.html, index.html, live.html, netlify/functions/, etc.)
4. Wait ~30 seconds → you get a URL like luminous-fox-123.netlify.app
5. That's your site! But sharing won't work yet until Step 3.

---

## Step 3: Connect Supabase to Netlify (5 minutes)

1. In Netlify, go to your site → Site Configuration → Environment Variables
2. Click "Add a variable" and add TWO variables:

   Variable 1:
   Key:   SUPABASE_URL
   Value: (paste your Project URL from Step 1)

   Variable 2:
   Key:   SUPABASE_SERVICE_KEY
   Value: (paste your service_role key from Step 1)

3. Click Save
4. Go to Deploys → "Trigger deploy" → "Deploy site"
5. Wait 1 minute → done!

---

## Step 4: Connect your domain (optional, ~10 minutes)

1. Buy germinal.art (or similar) at namecheap.com (~$12/yr)
2. In Netlify: Site Configuration → Domain Management → Add custom domain
3. Follow Netlify's instructions to point nameservers
4. SSL certificate is automatic and free

---

## That's it. Sharing now works:
- User presses Share → canvas saved to Supabase → short URL generated
- Recipient opens URL → canvas loads with sender's selections preserved
- Every canvas feeds the mother display at germinal.art/live
- Live display works as TV screensaver / museum installation
