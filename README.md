# YouTube2Podcast

Personal YouTube-to-private-podcast MVP.

## What it does

- Submit one YouTube video URL from the H5 console.
- Create an async conversion job.
- Convert through a pluggable audio provider.
- Store audio in Cloudflare R2.
- Store jobs and episodes in Cloudflare D1.
- Expose a private RSS feed for Apple Podcasts.

## Local setup

```bash
pnpm install
cp .env.example .env
cp wrangler.toml.example wrangler.toml
pnpm test
pnpm typecheck
```

## Cloudflare resources

Create:

```bash
wrangler d1 create youtube2podcast
wrangler r2 bucket create youtube2podcast-audio
wrangler queues create youtube2podcast-conversions
```

Apply D1 schema:

```bash
wrangler d1 execute youtube2podcast --file apps/worker/src/db/schema.sql
```

Set secrets:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put RSS_TOKEN
wrangler secret put AUDIO_PROVIDER_API_KEY
```

## Development

Worker:

```bash
pnpm dev:worker
```

Web:

```bash
pnpm dev:web
```

## Apple Podcasts

Subscribe to:

```txt
https://your-worker-domain/rss/<rss-token>.xml
```

## Important privacy notes

- Do not expose `ADMIN_TOKEN`.
- Do not expose provider API keys in the H5 app.
- R2 bucket should remain private.
- RSS token can be rotated if leaked.
