# YouTube2Podcast

Personal YouTube-to-private-podcast MVP.

## What it does

- Submit one YouTube video URL from the H5 console.
- Create an async conversion job.
- Convert through a pluggable audio provider.
- Store audio in Vercel Blob.
- Store jobs and episodes in Supabase Postgres.
- Expose a private RSS feed for Apple Podcasts.

## Local setup

```bash
pnpm install
cp .env.example .env
```

Fill `.env`, then in Supabase SQL Editor run `apps/worker/src/db/schema.sql`.

```bash
pnpm dev
```

Optional H5 on Vite (proxies API to `vercel dev` on port 3000):

```bash
pnpm dev:web
```

## Vercel

1. Create a Vercel project from this repo (root directory).
2. Create a Blob store and link it to the project.
3. Create a Supabase project, run `apps/worker/src/db/schema.sql`.
4. Set environment variables (Production + Preview):

```txt
ADMIN_TOKEN
RSS_TOKEN
AUDIO_PROVIDER=rapidapi
RAPIDAPI_KEY
PUBLIC_BASE_URL=https://your-app.vercel.app
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BLOB_READ_WRITE_TOKEN
VITE_API_BASE_URL=
VITE_PUBLIC_RSS_URL=https://your-app.vercel.app/rss/<RSS_TOKEN>.xml
```

`VITE_*` are baked in at build time; change them then redeploy.

5. Deploy. Open the H5, fill Admin Token, submit a YouTube URL.

## Apple Podcasts

Subscribe to:

```txt
https://your-app.vercel.app/rss/<rss-token>.xml
```

## Important privacy notes

- Do not expose `ADMIN_TOKEN`.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` or provider API keys in the H5 app.
- RSS token can be rotated if leaked (Blob paths include the token; old files stay reachable by URL).
