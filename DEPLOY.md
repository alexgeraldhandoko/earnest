# EARNest on Render — any chat can publish

Production model: this git repo is the source of truth. Render auto-deploys
every push to `main`. No chat owns the deployment — any chat with this
workspace can ship.

## Publish (any chat)
1. Edit the app source in the workspace root (`server/`, `public/`).
2. Rebuild this repo: `node scripts/build-render-deploy.cjs` (workspace root).
3. `git -C deploy-render add -A && git -C deploy-render commit -m "..." && git -C deploy-render push`
4. Render deploys automatically (~1–2 min). Free tier sleeps after 15 min
   idle; the next visit takes ~1 min to wake.

## One-time setup
1. **GitHub**: create a private repo, push this directory (`git remote add
   origin <url> && git push -u origin main`).
2. **Supabase** (free project): run `scripts/supabase-schema.sql` in the SQL
   editor, then from the workspace root:
   `SUPABASE_URL=... SUPABASE_ANON_KEY=... node --experimental-sqlite deploy-render/scripts/migrate-to-supabase.cjs`
   This mirrors the curated DB (studies, researchers, demo accounts, config
   incl. OAuth/LLM keys) and uploads the 5 demo reels.
3. **Render**: New → Blueprint → connect the repo. It reads `render.yaml`.
   Set the three secret env vars in the Render dashboard:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `PUBLIC_BASE_URL`
   (= `https://<your-service>.onrender.com`).
4. Verify: app loads, demo logins work (`demo@earnest.app` / `demo1234`,
   `researcher@earnest.app` / `demo1234`), the 5 feed reels play.

## Notes
- Durable data lives in Supabase (`app_tables` snapshots + `video_clips`);
  the Render filesystem is ephemeral. Never rely on runtime uploads persisting.
- The 5 demo reels serve same-origin from Supabase; the rest of the clip
  library streams from the legacy QW Page (ptc2aptn), which stays live.
- Secrets are NOT in this repo (see .gitignore). Config/secrets reach the
  runtime via the Supabase mirror. Do not commit .env or token files.
- Game generation uses GEN_PROVIDER=api with the LLM key from the mirrored
  config (the local QwenWork agent worker is not available on Render).
- Instagram DM responder: the frozen page xuw6xcjq keeps the registered OAuth
  callback + Outstand webhook. Render borrows its access tokens via the
  capture proxy (config `qw_token_source`, `qw_self_base`) and polls
  Outstand for inbound DMs; the sibling is sunk via its `api_base` config so
  it never double-answers. Outstand/IG keys live in the mirrored config
  (`outstand_api_key`, `ig_poll_token`, `ig_signing_secret`), never in git.
