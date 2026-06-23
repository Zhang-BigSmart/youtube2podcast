# YouTube2Podcast MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal YouTube-to-private-podcast MVP where a user submits one YouTube URL, the system converts it through a pluggable audio provider, stores audio in R2, exposes a private RSS feed, and lets Apple Podcasts play the episode through a protected media endpoint.

**Architecture:** A TypeScript monorepo with one Cloudflare Worker for API/RSS/media/queue consumer logic and one Vite H5 console for submitting jobs and viewing status. D1 is the source of truth, R2 stores audio assets, Cloudflare Queues runs conversion asynchronously, and an `AudioProvider` abstraction keeps the third-party provider replaceable.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare Queues, Cloudflare D1, Cloudflare R2, Wrangler, Vite, React, Vitest.

---

## Scope Check

This plan implements one focused MVP from the approved spec:

- Single-user personal tool.
- Single-video URL submission.
- Queue-based async conversion.
- D1 jobs/settings/episodes.
- R2 audio storage.
- Private RSS and protected media proxy.
- H5 control console.
- Mock provider for local tests plus configurable HTTP provider for real provider trials.

This plan does not implement playlist/channel sync, multi-user auth, web playback, native iOS app, transcript/summarization, or self-hosted YouTube downloading.

## File Structure

Create this structure:

```txt
package.json
pnpm-workspace.yaml
.gitignore
.env.example
README.md
wrangler.toml.example

apps/
  worker/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts
      env.ts
      router.ts
      auth.ts
      ids.ts
      youtube.ts
      responses.ts
      db/
        schema.sql
        jobs.ts
        episodes.ts
        settings.ts
      providers/
        types.ts
        mock.ts
        http.ts
        index.ts
      services/
        jobs.ts
        converter.ts
        rss.ts
        media.ts
      tests/
        youtube.test.ts
        auth.test.ts
        rss.test.ts
        jobs.test.ts
        media.test.ts

  web/
    package.json
    tsconfig.json
    vite.config.ts
    index.html
    src/
      main.tsx
      App.tsx
      api.ts
      styles.css
```

Boundaries:

- `apps/worker/src/router.ts` maps requests to services and contains no business logic.
- `apps/worker/src/services/*` contains business behavior.
- `apps/worker/src/db/*` contains D1 queries only.
- `apps/worker/src/providers/*` contains audio provider implementations.
- `apps/web/src/*` is a small console; it never sees provider credentials.

## Task 1: Scaffold workspace and tooling

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `wrangler.toml.example`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `apps/worker/vitest.config.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`

- [ ] **Step 1: Create workspace manifests**

Root `package.json`:

```json
{
  "name": "youtube2podcast",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:worker": "pnpm --filter @youtube2podcast/worker dev",
    "dev:web": "pnpm --filter @youtube2podcast/web dev",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build"
  },
  "packageManager": "pnpm@9.15.0",
  "devDependencies": {
    "typescript": "^5.5.4"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
```

`.gitignore`:

```gitignore
node_modules
dist
.wrangler
.dev.vars
.env
*.local
```

- [ ] **Step 2: Create environment examples**

`.env.example`:

```bash
ADMIN_TOKEN=change-me-admin-token
RSS_TOKEN=change-me-rss-token
AUDIO_PROVIDER=mock
AUDIO_PROVIDER_ENDPOINT=https://example.com/extract
AUDIO_PROVIDER_API_KEY=change-me-provider-key
PUBLIC_API_BASE_URL=http://localhost:8787
PUBLIC_RSS_URL=http://localhost:8787/rss/change-me-rss-token.xml
```

`wrangler.toml.example`:

```toml
name = "youtube2podcast-worker"
main = "apps/worker/src/index.ts"
compatibility_date = "2026-06-24"

[[d1_databases]]
binding = "DB"
database_name = "youtube2podcast"
database_id = "replace-with-d1-database-id"

[[r2_buckets]]
binding = "AUDIO_BUCKET"
bucket_name = "youtube2podcast-audio"

[[queues.producers]]
binding = "CONVERSION_QUEUE"
queue = "youtube2podcast-conversions"

[[queues.consumers]]
queue = "youtube2podcast-conversions"
max_batch_size = 1
max_batch_timeout = 30

[vars]
AUDIO_PROVIDER = "mock"
PUBLIC_BASE_URL = "https://replace-with-worker-domain"
```

`README.md`:

```md
# YouTube2Podcast

Personal YouTube-to-private-podcast MVP.

See `docs/superpowers/specs/2026-06-24-youtube2podcast-design.md` for the approved design and `docs/superpowers/plans/2026-06-24-youtube2podcast-mvp.md` for the implementation plan.
```

- [ ] **Step 3: Create worker package config**

`apps/worker/package.json`:

```json
{
  "name": "@youtube2podcast/worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --local",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.20240620.0"
  },
  "devDependencies": {
    "vitest": "^2.1.1",
    "wrangler": "^3.78.0"
  }
}
```

`apps/worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

`apps/worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts']
  }
})
```

- [ ] **Step 4: Create web package config**

`apps/web/package.json`:

```json
{
  "name": "@youtube2podcast/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "typecheck": "tsc --noEmit",
    "build": "vite build",
    "test": "tsc --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.4"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "jsx": "react-jsx",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
})
```

- [ ] **Step 5: Install dependencies and verify**

Run:

```bash
pnpm install
pnpm typecheck
pnpm test
```

Expected:

- `pnpm install` completes.
- `pnpm typecheck` succeeds or reports no source files until source files are added.
- `pnpm test` succeeds or reports no tests until tests are added.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .env.example README.md wrangler.toml.example apps
git commit -m "chore: scaffold youtube2podcast workspace"
```

## Task 2: Add shared Worker types, responses, auth, IDs, and YouTube URL parsing

**Files:**

- Create: `apps/worker/src/env.ts`
- Create: `apps/worker/src/responses.ts`
- Create: `apps/worker/src/auth.ts`
- Create: `apps/worker/src/ids.ts`
- Create: `apps/worker/src/youtube.ts`
- Create: `apps/worker/src/tests/youtube.test.ts`
- Create: `apps/worker/src/tests/auth.test.ts`

- [ ] **Step 1: Write YouTube parser tests**

`apps/worker/src/tests/youtube.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseYouTubeVideoId } from '../youtube'

describe('parseYouTubeVideoId', () => {
  it('parses watch URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=v1wZwxY3CMg')).toBe('v1wZwxY3CMg')
  })

  it('parses short youtu.be URLs', () => {
    expect(parseYouTubeVideoId('https://youtu.be/v1wZwxY3CMg')).toBe('v1wZwxY3CMg')
  })

  it('rejects playlist-only URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/playlist?list=abc')).toBeNull()
  })

  it('rejects non-youtube URLs', () => {
    expect(parseYouTubeVideoId('https://example.com/watch?v=v1wZwxY3CMg')).toBeNull()
  })
})
```

- [ ] **Step 2: Write auth tests**

`apps/worker/src/tests/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isAuthorizedAdmin } from '../auth'

describe('isAuthorizedAdmin', () => {
  it('accepts bearer token', () => {
    const request = new Request('https://example.com/api/jobs', {
      headers: { Authorization: 'Bearer secret-admin' }
    })
    expect(isAuthorizedAdmin(request, 'secret-admin')).toBe(true)
  })

  it('rejects missing bearer token', () => {
    const request = new Request('https://example.com/api/jobs')
    expect(isAuthorizedAdmin(request, 'secret-admin')).toBe(false)
  })

  it('rejects wrong token', () => {
    const request = new Request('https://example.com/api/jobs', {
      headers: { Authorization: 'Bearer wrong' }
    })
    expect(isAuthorizedAdmin(request, 'secret-admin')).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm --filter @youtube2podcast/worker test
```

Expected:

- Fails because `../youtube` and `../auth` do not exist yet.

- [ ] **Step 4: Implement helper files**

`apps/worker/src/env.ts`:

```ts
export type Env = {
  DB: D1Database
  AUDIO_BUCKET: R2Bucket
  CONVERSION_QUEUE: Queue<ConversionMessage>
  ADMIN_TOKEN: string
  RSS_TOKEN: string
  AUDIO_PROVIDER: 'mock' | 'http'
  AUDIO_PROVIDER_ENDPOINT?: string
  AUDIO_PROVIDER_API_KEY?: string
  PUBLIC_BASE_URL: string
}

export type ConversionMessage = {
  jobId: string
}
```

`apps/worker/src/responses.ts`:

```ts
export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {})
    }
  })
}

export function text(data: string, init: ResponseInit = {}): Response {
  return new Response(data, {
    ...init,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...(init.headers ?? {})
    }
  })
}

export function notFound(): Response {
  return text('Not found', { status: 404 })
}
```

`apps/worker/src/auth.ts`:

```ts
export function isAuthorizedAdmin(request: Request, adminToken: string): boolean {
  const header = request.headers.get('authorization')
  return header === `Bearer ${adminToken}`
}

export function isValidToken(actual: string, expected: string): boolean {
  return actual.length > 0 && actual === expected
}
```

`apps/worker/src/ids.ts`:

```ts
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}
```

`apps/worker/src/youtube.ts`:

```ts
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/

export function parseYouTubeVideoId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = url.searchParams.get('v')
    return id && VIDEO_ID_PATTERN.test(id) ? id : null
  }

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && VIDEO_ID_PATTERN.test(id) ? id : null
  }

  return null
}
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter @youtube2podcast/worker test
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- YouTube parser tests pass.
- Auth tests pass.
- Typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src
git commit -m "feat: add worker utilities and youtube parsing"
```

## Task 3: Add D1 schema and repositories

**Files:**

- Create: `apps/worker/src/db/schema.sql`
- Create: `apps/worker/src/db/jobs.ts`
- Create: `apps/worker/src/db/episodes.ts`
- Create: `apps/worker/src/db/settings.ts`

- [ ] **Step 1: Create D1 schema**

`apps/worker/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  youtube_url TEXT NOT NULL,
  youtube_video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  provider TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  episode_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_youtube_video_id ON jobs (youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  youtube_video_id TEXT NOT NULL UNIQUE,
  youtube_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  thumbnail_url TEXT,
  r2_audio_key TEXT NOT NULL,
  r2_image_key TEXT,
  audio_mime_type TEXT NOT NULL,
  audio_file_size INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  guid TEXT NOT NULL UNIQUE,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodes_created_at ON episodes (created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 2: Create job repository**

`apps/worker/src/db/jobs.ts`:

```ts
export type JobStatus = 'pending' | 'processing' | 'uploading' | 'completed' | 'failed'

export type JobRecord = {
  id: string
  youtube_url: string
  youtube_video_id: string
  status: JobStatus
  error_message: string | null
  provider: string | null
  attempt_count: number
  episode_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export async function insertJob(db: D1Database, job: JobRecord): Promise<void> {
  await db.prepare(
    `INSERT INTO jobs
     (id, youtube_url, youtube_video_id, status, error_message, provider, attempt_count, episode_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    job.id,
    job.youtube_url,
    job.youtube_video_id,
    job.status,
    job.error_message,
    job.provider,
    job.attempt_count,
    job.episode_id,
    job.created_at,
    job.updated_at,
    job.completed_at
  ).run()
}

export async function getJob(db: D1Database, id: string): Promise<JobRecord | null> {
  return await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRecord>()
}

export async function listJobs(db: D1Database, limit = 50): Promise<JobRecord[]> {
  const result = await db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').bind(limit).all<JobRecord>()
  return result.results ?? []
}

export async function updateJobStatus(
  db: D1Database,
  id: string,
  status: JobStatus,
  fields: { errorMessage?: string | null; episodeId?: string | null; provider?: string | null; completedAt?: string | null } = {}
): Promise<void> {
  await db.prepare(
    `UPDATE jobs
     SET status = ?, error_message = COALESCE(?, error_message), episode_id = COALESCE(?, episode_id),
         provider = COALESCE(?, provider), completed_at = COALESCE(?, completed_at), updated_at = ?
     WHERE id = ?`
  ).bind(status, fields.errorMessage ?? null, fields.episodeId ?? null, fields.provider ?? null, fields.completedAt ?? null, new Date().toISOString(), id).run()
}

export async function incrementAttempt(db: D1Database, id: string): Promise<void> {
  await db.prepare(
    `UPDATE jobs
     SET attempt_count = attempt_count + 1, status = 'pending', error_message = NULL, updated_at = ?
     WHERE id = ?`
  ).bind(new Date().toISOString(), id).run()
}
```

- [ ] **Step 3: Create episode repository**

`apps/worker/src/db/episodes.ts`:

```ts
export type EpisodeRecord = {
  id: string
  youtube_video_id: string
  youtube_url: string
  title: string
  description: string
  channel_title: string
  thumbnail_url: string | null
  r2_audio_key: string
  r2_image_key: string | null
  audio_mime_type: string
  audio_file_size: number
  duration_seconds: number
  guid: string
  published_at: string
  created_at: string
}

export async function insertEpisode(db: D1Database, episode: EpisodeRecord): Promise<void> {
  await db.prepare(
    `INSERT INTO episodes
     (id, youtube_video_id, youtube_url, title, description, channel_title, thumbnail_url, r2_audio_key, r2_image_key,
      audio_mime_type, audio_file_size, duration_seconds, guid, published_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    episode.id,
    episode.youtube_video_id,
    episode.youtube_url,
    episode.title,
    episode.description,
    episode.channel_title,
    episode.thumbnail_url,
    episode.r2_audio_key,
    episode.r2_image_key,
    episode.audio_mime_type,
    episode.audio_file_size,
    episode.duration_seconds,
    episode.guid,
    episode.published_at,
    episode.created_at
  ).run()
}

export async function getEpisode(db: D1Database, id: string): Promise<EpisodeRecord | null> {
  return await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first<EpisodeRecord>()
}

export async function getEpisodeByVideoId(db: D1Database, videoId: string): Promise<EpisodeRecord | null> {
  return await db.prepare('SELECT * FROM episodes WHERE youtube_video_id = ?').bind(videoId).first<EpisodeRecord>()
}

export async function listEpisodes(db: D1Database, limit = 100): Promise<EpisodeRecord[]> {
  const result = await db.prepare('SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?').bind(limit).all<EpisodeRecord>()
  return result.results ?? []
}
```

- [ ] **Step 4: Create settings repository**

`apps/worker/src/db/settings.ts`:

```ts
export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function upsertSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run()
}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- Typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/db
git commit -m "feat: add d1 schema and repositories"
```

## Task 4: Implement provider abstraction and mock/http providers

**Files:**

- Create: `apps/worker/src/providers/types.ts`
- Create: `apps/worker/src/providers/mock.ts`
- Create: `apps/worker/src/providers/http.ts`
- Create: `apps/worker/src/providers/index.ts`

- [ ] **Step 1: Create provider types**

`apps/worker/src/providers/types.ts`:

```ts
export type AudioProviderResult = {
  title?: string
  description?: string
  channelTitle?: string
  durationSeconds?: number
  thumbnailUrl?: string
  audioDownloadUrl: string
  audioMimeType?: string
  audioFileSize?: number
}

export interface AudioProvider {
  extract(youtubeUrl: string): Promise<AudioProviderResult>
}
```

- [ ] **Step 2: Create mock provider**

`apps/worker/src/providers/mock.ts`:

```ts
import type { AudioProvider, AudioProviderResult } from './types'

export class MockAudioProvider implements AudioProvider {
  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    return {
      title: 'Mock YouTube Episode',
      description: `Mock audio generated for ${youtubeUrl}`,
      channelTitle: 'Mock Channel',
      durationSeconds: 60,
      audioDownloadUrl: 'https://example.com/mock-audio.mp3',
      audioMimeType: 'audio/mpeg',
      audioFileSize: 1024
    }
  }
}
```

- [ ] **Step 3: Create configurable HTTP provider**

`apps/worker/src/providers/http.ts`:

```ts
import type { AudioProvider, AudioProviderResult } from './types'

export class HttpAudioProvider implements AudioProvider {
  constructor(private readonly endpoint: string, private readonly apiKey: string) {}

  async extract(youtubeUrl: string): Promise<AudioProviderResult> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ youtubeUrl })
    })

    if (!response.ok) {
      throw new Error(`Audio provider failed with HTTP ${response.status}`)
    }

    const data = await response.json<AudioProviderResult>()
    if (!data.audioDownloadUrl) {
      throw new Error('Audio provider response missing audioDownloadUrl')
    }

    return data
  }
}
```

- [ ] **Step 4: Create provider factory**

`apps/worker/src/providers/index.ts`:

```ts
import type { Env } from '../env'
import { HttpAudioProvider } from './http'
import { MockAudioProvider } from './mock'
import type { AudioProvider } from './types'

export function createAudioProvider(env: Env): AudioProvider {
  if (env.AUDIO_PROVIDER === 'mock') {
    return new MockAudioProvider()
  }

  if (env.AUDIO_PROVIDER === 'http') {
    if (!env.AUDIO_PROVIDER_ENDPOINT || !env.AUDIO_PROVIDER_API_KEY) {
      throw new Error('AUDIO_PROVIDER_ENDPOINT and AUDIO_PROVIDER_API_KEY are required for http provider')
    }
    return new HttpAudioProvider(env.AUDIO_PROVIDER_ENDPOINT, env.AUDIO_PROVIDER_API_KEY)
  }

  throw new Error(`Unsupported AUDIO_PROVIDER: ${env.AUDIO_PROVIDER}`)
}
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- Typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/providers
git commit -m "feat: add audio provider abstraction"
```

## Task 5: Implement job service primitives

**Files:**

- Create: `apps/worker/src/services/jobs.ts`
- Create: `apps/worker/src/tests/jobs.test.ts`

- [ ] **Step 1: Write job service test**

`apps/worker/src/tests/jobs.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createJobResponse } from '../services/jobs'

describe('createJobResponse', () => {
  it('returns invalid_youtube_url for bad URLs', async () => {
    const result = await createJobResponse({
      youtubeUrl: 'https://example.com/nope',
      existingEpisode: null,
      enqueue: vi.fn()
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toBe('invalid_youtube_url')
  })
})
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @youtube2podcast/worker test -- src/tests/jobs.test.ts
```

Expected:

- Fails because `../services/jobs` does not exist yet.

- [ ] **Step 3: Implement job service**

`apps/worker/src/services/jobs.ts`:

```ts
import { createId } from '../ids'
import { parseYouTubeVideoId } from '../youtube'
import type { EpisodeRecord } from '../db/episodes'

export type CreateJobResult =
  | { ok: true; status: 202; jobId: string; youtubeVideoId: string }
  | { ok: true; status: 200; episodeId: string; youtubeVideoId: string; alreadyExists: true }
  | { ok: false; status: 400; error: 'invalid_youtube_url' }

export async function createJobResponse(input: {
  youtubeUrl: string
  existingEpisode: EpisodeRecord | null
  enqueue: (jobId: string) => Promise<void>
}): Promise<CreateJobResult> {
  const youtubeVideoId = parseYouTubeVideoId(input.youtubeUrl)
  if (!youtubeVideoId) {
    return { ok: false, status: 400, error: 'invalid_youtube_url' }
  }

  if (input.existingEpisode) {
    return {
      ok: true,
      status: 200,
      episodeId: input.existingEpisode.id,
      youtubeVideoId,
      alreadyExists: true
    }
  }

  const jobId = createId('job')
  await input.enqueue(jobId)
  return { ok: true, status: 202, jobId, youtubeVideoId }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @youtube2podcast/worker test
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- Job service tests pass.
- Typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/services/jobs.ts apps/worker/src/tests/jobs.test.ts
git commit -m "feat: add job service primitives"
```

## Task 6: Implement RSS rendering

**Files:**

- Create: `apps/worker/src/services/rss.ts`
- Create: `apps/worker/src/tests/rss.test.ts`

- [ ] **Step 1: Write RSS test**

`apps/worker/src/tests/rss.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import { renderRss } from '../services/rss'

describe('renderRss', () => {
  it('renders podcast rss with enclosure', () => {
    const rss = renderRss([
      {
        id: 'ep_1',
        youtube_video_id: 'v1wZwxY3CMg',
        youtube_url: 'https://www.youtube.com/watch?v=v1wZwxY3CMg',
        title: 'Test Episode',
        description: 'A test episode',
        channel_title: 'Test Channel',
        thumbnail_url: null,
        r2_audio_key: 'audio/ep_1.mp3',
        r2_image_key: null,
        audio_mime_type: 'audio/mpeg',
        audio_file_size: 1234,
        duration_seconds: 60,
        guid: 'youtube:v1wZwxY3CMg',
        published_at: '2026-06-24T00:00:00.000Z',
        created_at: '2026-06-24T00:00:00.000Z'
      }
    ], {
      PUBLIC_BASE_URL: 'https://pod.example.com',
      RSS_TOKEN: 'rss-secret'
    } as Env)

    expect(rss).toContain('<rss version="2.0"')
    expect(rss).toContain('<title>Test Episode</title>')
    expect(rss).toContain('url="https://pod.example.com/media/rss-secret/ep_1/audio"')
    expect(rss).toContain('type="audio/mpeg"')
    expect(rss).toContain('length="1234"')
  })
})
```

- [ ] **Step 2: Implement RSS renderer**

`apps/worker/src/services/rss.ts`:

```ts
import type { Env } from '../env'
import type { EpisodeRecord } from '../db/episodes'

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((part) => String(part).padStart(2, '0')).join(':')
}

export function renderRss(episodes: EpisodeRecord[], env: Pick<Env, 'PUBLIC_BASE_URL' | 'RSS_TOKEN'>): string {
  const items = episodes.map((episode) => {
    const audioUrl = `${env.PUBLIC_BASE_URL}/media/${env.RSS_TOKEN}/${episode.id}/audio`
    return `
      <item>
        <title>${escapeXml(episode.title)}</title>
        <description>${escapeXml(episode.description)}</description>
        <pubDate>${new Date(episode.published_at).toUTCString()}</pubDate>
        <guid isPermaLink="false">${escapeXml(episode.guid)}</guid>
        <itunes:duration>${formatDuration(episode.duration_seconds)}</itunes:duration>
        <itunes:author>${escapeXml(episode.channel_title)}</itunes:author>
        <enclosure url="${escapeXml(audioUrl)}" length="${episode.audio_file_size}" type="${escapeXml(episode.audio_mime_type)}" />
      </item>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>YouTube2Podcast</title>
    <description>Private YouTube audio feed</description>
    <language>zh-cn</language>
    <itunes:author>YouTube2Podcast</itunes:author>
    ${items}
  </channel>
</rss>`
}
```

- [ ] **Step 3: Run RSS test**

Run:

```bash
pnpm --filter @youtube2podcast/worker test -- src/tests/rss.test.ts
```

Expected:

- RSS test passes.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/rss.ts apps/worker/src/tests/rss.test.ts
git commit -m "feat: render private podcast rss"
```

## Task 7: Implement media proxy with HEAD and Range support

**Files:**

- Create: `apps/worker/src/services/media.ts`
- Create: `apps/worker/src/tests/media.test.ts`

- [ ] **Step 1: Write range parser test**

`apps/worker/src/tests/media.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseRangeHeader } from '../services/media'

describe('parseRangeHeader', () => {
  it('parses byte ranges', () => {
    expect(parseRangeHeader('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
  })

  it('clamps open-ended ranges', () => {
    expect(parseRangeHeader('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
  })

  it('rejects invalid ranges', () => {
    expect(parseRangeHeader('items=1-2', 100)).toBeNull()
    expect(parseRangeHeader('bytes=200-300', 100)).toBeNull()
  })
})
```

- [ ] **Step 2: Implement media service**

`apps/worker/src/services/media.ts`:

```ts
import type { Env } from '../env'
import { isValidToken } from '../auth'
import { getEpisode } from '../db/episodes'
import { notFound } from '../responses'

export type ParsedRange = { start: number; end: number }

export function parseRangeHeader(header: string | null, size: number): ParsedRange | null {
  if (!header) return null
  const match = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return null

  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : size - 1
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || end < start || start >= size) return null

  return { start, end: Math.min(end, size - 1) }
}

export async function serveAudio(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/media\/([^/]+)\/([^/]+)\/audio$/)
  if (!match) return notFound()

  const [, token, episodeId] = match
  if (!isValidToken(token, env.RSS_TOKEN)) return notFound()

  const episode = await getEpisode(env.DB, episodeId)
  if (!episode) return notFound()

  const head = await env.AUDIO_BUCKET.head(episode.r2_audio_key)
  if (!head) return notFound()

  const size = head.size
  const range = parseRangeHeader(request.headers.get('range'), size)
  const object = await env.AUDIO_BUCKET.get(
    episode.r2_audio_key,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined
  )
  if (!object) return notFound()

  const headers = new Headers()
  headers.set('accept-ranges', 'bytes')
  headers.set('content-type', episode.audio_mime_type)
  headers.set('cache-control', 'private, max-age=3600')

  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${size}`)
    headers.set('content-length', String(range.end - range.start + 1))
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers })
  }

  headers.set('content-length', String(size))
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}
```

- [ ] **Step 3: Run media tests**

Run:

```bash
pnpm --filter @youtube2podcast/worker test -- src/tests/media.test.ts
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- Range parser tests pass.
- Typecheck passes after service imports are resolved.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/media.ts apps/worker/src/tests/media.test.ts
git commit -m "feat: proxy podcast audio with range support"
```

## Task 8: Implement queue conversion service

**Files:**

- Create: `apps/worker/src/services/converter.ts`

- [ ] **Step 1: Implement conversion flow**

`apps/worker/src/services/converter.ts`:

```ts
import type { Env } from '../env'
import { getJob, updateJobStatus } from '../db/jobs'
import { insertEpisode } from '../db/episodes'
import { createId } from '../ids'
import { createAudioProvider } from '../providers'

async function uploadFromUrl(bucket: R2Bucket, key: string, url: string, fallbackType: string): Promise<{ size: number; contentType: string }> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download provider audio: HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? fallbackType
  const sizeHeader = response.headers.get('content-length')
  await bucket.put(key, response.body, {
    httpMetadata: { contentType }
  })

  return {
    size: sizeHeader ? Number(sizeHeader) : 0,
    contentType
  }
}

export async function convertJob(jobId: string, env: Env): Promise<void> {
  const job = await getJob(env.DB, jobId)
  if (!job) return
  if (job.status === 'completed') return

  const providerName = env.AUDIO_PROVIDER
  await updateJobStatus(env.DB, job.id, 'processing', { provider: providerName, errorMessage: null })

  try {
    const provider = createAudioProvider(env)
    const result = await provider.extract(job.youtube_url)
    await updateJobStatus(env.DB, job.id, 'uploading')

    const episodeId = createId('ep')
    const extension = result.audioMimeType === 'audio/mp4' ? 'm4a' : 'mp3'
    const audioKey = `audio/${episodeId}.${extension}`
    const uploaded = await uploadFromUrl(env.AUDIO_BUCKET, audioKey, result.audioDownloadUrl, result.audioMimeType ?? 'audio/mpeg')

    const now = new Date().toISOString()
    await insertEpisode(env.DB, {
      id: episodeId,
      youtube_video_id: job.youtube_video_id,
      youtube_url: job.youtube_url,
      title: result.title ?? `YouTube ${job.youtube_video_id}`,
      description: result.description ?? job.youtube_url,
      channel_title: result.channelTitle ?? 'YouTube',
      thumbnail_url: result.thumbnailUrl ?? null,
      r2_audio_key: audioKey,
      r2_image_key: null,
      audio_mime_type: result.audioMimeType ?? uploaded.contentType,
      audio_file_size: result.audioFileSize ?? uploaded.size,
      duration_seconds: result.durationSeconds ?? 0,
      guid: `youtube:${job.youtube_video_id}`,
      published_at: now,
      created_at: now
    })

    await updateJobStatus(env.DB, job.id, 'completed', {
      episodeId,
      completedAt: now,
      errorMessage: null
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown conversion error'
    await updateJobStatus(env.DB, job.id, 'failed', { errorMessage: message })
  }
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- Typecheck passes.

- [ ] **Step 3: Run full worker tests**

Run:

```bash
pnpm --filter @youtube2podcast/worker test
```

Expected:

- All worker tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/converter.ts
git commit -m "feat: process queued conversion jobs"
```

## Task 9: Assemble Worker router and queue entry

**Files:**

- Create: `apps/worker/src/router.ts`
- Create: `apps/worker/src/index.ts`

- [ ] **Step 1: Create router**

`apps/worker/src/router.ts`:

```ts
import type { Env } from './env'
import { isAuthorizedAdmin, isValidToken } from './auth'
import { json, notFound, text } from './responses'
import { parseYouTubeVideoId } from './youtube'
import { createId } from './ids'
import { getEpisodeByVideoId, listEpisodes } from './db/episodes'
import { getJob, incrementAttempt, insertJob, listJobs } from './db/jobs'
import { renderRss } from './services/rss'
import { serveAudio } from './services/media'

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/rss/')) {
    const token = url.pathname.replace('/rss/', '').replace(/\.xml$/, '')
    if (!isValidToken(token, env.RSS_TOKEN)) return notFound()
    const episodes = await listEpisodes(env.DB, 100)
    return new Response(renderRss(episodes, env), {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
    })
  }

  if (url.pathname.startsWith('/media/')) {
    return serveAudio(request, env)
  }

  if (url.pathname.startsWith('/api/') && !isAuthorizedAdmin(request, env.ADMIN_TOKEN)) {
    return json({ error: 'unauthorized' }, { status: 401 })
  }

  if (request.method === 'POST' && url.pathname === '/api/jobs') {
    const body = await request.json<{ youtubeUrl?: string }>()
    const youtubeUrl = body.youtubeUrl ?? ''
    const youtubeVideoId = parseYouTubeVideoId(youtubeUrl)
    if (!youtubeVideoId) return json({ error: 'invalid_youtube_url' }, { status: 400 })

    const existingEpisode = await getEpisodeByVideoId(env.DB, youtubeVideoId)
    if (existingEpisode) {
      return json({ episodeId: existingEpisode.id, status: 'completed', alreadyExists: true }, { status: 200 })
    }

    const now = new Date().toISOString()
    const jobId = createId('job')
    await insertJob(env.DB, {
      id: jobId,
      youtube_url: youtubeUrl,
      youtube_video_id: youtubeVideoId,
      status: 'pending',
      error_message: null,
      provider: null,
      attempt_count: 0,
      episode_id: null,
      created_at: now,
      updated_at: now,
      completed_at: null
    })
    await env.CONVERSION_QUEUE.send({ jobId })
    return json({ jobId, status: 'pending' }, { status: 202 })
  }

  if (request.method === 'GET' && url.pathname === '/api/jobs') {
    return json({ jobs: await listJobs(env.DB) })
  }

  const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/)
  if (request.method === 'GET' && jobMatch) {
    const job = await getJob(env.DB, jobMatch[1])
    return job ? json(job) : notFound()
  }

  const retryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/)
  if (request.method === 'POST' && retryMatch) {
    const job = await getJob(env.DB, retryMatch[1])
    if (!job) return notFound()
    if (job.status !== 'failed') return json({ error: 'job_not_failed' }, { status: 409 })
    await incrementAttempt(env.DB, job.id)
    await env.CONVERSION_QUEUE.send({ jobId: job.id })
    return json({ jobId: job.id, status: 'pending' })
  }

  if (request.method === 'GET' && url.pathname === '/api/episodes') {
    return json({ episodes: await listEpisodes(env.DB) })
  }

  return text('YouTube2Podcast worker', { status: 200 })
}
```

- [ ] **Step 2: Create Worker entry with queue consumer**

`apps/worker/src/index.ts`:

```ts
import type { ConversionMessage, Env } from './env'
import { handleRequest } from './router'
import { convertJob } from './services/converter'

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env)
  },

  async queue(batch: MessageBatch<ConversionMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await convertJob(message.body.jobId, env)
      message.ack()
    }
  }
}
```

- [ ] **Step 3: Run worker checks**

Run:

```bash
pnpm --filter @youtube2podcast/worker test
pnpm --filter @youtube2podcast/worker typecheck
```

Expected:

- All worker tests pass.
- Typecheck passes.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/router.ts apps/worker/src/index.ts
git commit -m "feat: assemble worker api and queue entry"
```

## Task 10: Build H5 control console

**Files:**

- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/styles.css`

- [ ] **Step 1: Create HTML entry**

`apps/web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>YouTube2Podcast</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create API client**

`apps/web/src/api.ts`:

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

export type Job = {
  id: string
  youtube_url: string
  youtube_video_id: string
  status: string
  error_message: string | null
  episode_id: string | null
  created_at: string
}

export type Episode = {
  id: string
  title: string
  channel_title: string
  duration_seconds: number
  created_at: string
}

function adminHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  }
}

export async function createJob(token: string, youtubeUrl: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}/api/jobs`, {
    method: 'POST',
    headers: adminHeaders(token),
    body: JSON.stringify({ youtubeUrl })
  })
  return response.json()
}

export async function listJobs(token: string): Promise<Job[]> {
  const response = await fetch(`${API_BASE}/api/jobs`, { headers: adminHeaders(token) })
  const data = await response.json<{ jobs: Job[] }>()
  return data.jobs
}

export async function listEpisodes(token: string): Promise<Episode[]> {
  const response = await fetch(`${API_BASE}/api/episodes`, { headers: adminHeaders(token) })
  const data = await response.json<{ episodes: Episode[] }>()
  return data.episodes
}

export async function retryJob(token: string, jobId: string): Promise<void> {
  await fetch(`${API_BASE}/api/jobs/${jobId}/retry`, {
    method: 'POST',
    headers: adminHeaders(token)
  })
}
```

- [ ] **Step 3: Create React app**

`apps/web/src/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { createJob, listEpisodes, listJobs, retryJob, type Episode, type Job } from './api'
import './styles.css'

const rssUrl = import.meta.env.VITE_PUBLIC_RSS_URL ?? 'http://localhost:8787/rss/change-me-rss-token.xml'

export function App() {
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('adminToken') ?? '')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [message, setMessage] = useState('')

  async function refresh() {
    if (!adminToken) return
    setJobs(await listJobs(adminToken))
    setEpisodes(await listEpisodes(adminToken))
  }

  async function submit() {
    localStorage.setItem('adminToken', adminToken)
    const result = await createJob(adminToken, youtubeUrl)
    setMessage(JSON.stringify(result))
    setYoutubeUrl('')
    await refresh()
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [adminToken])

  return (
    <main className="container">
      <h1>YouTube2Podcast</h1>
      <p className="muted">私人 YouTube 转播客控制台。第一版只负责提交、状态和 RSS。</p>

      <section className="card">
        <label>Admin Token</label>
        <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="输入管理 token" />
        <label>YouTube URL</label>
        <input value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
        <button onClick={submit} disabled={!adminToken || !youtubeUrl}>提交转换</button>
        {message && <pre>{message}</pre>}
      </section>

      <section className="card">
        <h2>私人 RSS</h2>
        <code>{rssUrl}</code>
      </section>

      <section className="card">
        <h2>任务</h2>
        {jobs.map((job) => (
          <div className="row" key={job.id}>
            <span>{job.youtube_video_id}</span>
            <strong>{job.status}</strong>
            {job.error_message && <em>{job.error_message}</em>}
            {job.status === 'failed' && <button onClick={() => retryJob(adminToken, job.id).then(refresh)}>重试</button>}
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Episodes</h2>
        {episodes.map((episode) => (
          <div className="row" key={episode.id}>
            <span>{episode.title}</span>
            <small>{episode.channel_title}</small>
          </div>
        ))}
      </section>
    </main>
  )
}
```

`apps/web/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 4: Create CSS**

`apps/web/src/styles.css`:

```css
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f7f9;
  color: #172033;
}

.container {
  max-width: 860px;
  margin: 0 auto;
  padding: 32px 16px;
}

.muted {
  color: #667085;
}

.card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 20px;
  margin: 16px 0;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
}

label {
  display: block;
  margin: 12px 0 6px;
  font-weight: 600;
}

input {
  box-sizing: border-box;
  width: 100%;
  padding: 12px;
  border: 1px solid #cfd4dc;
  border-radius: 10px;
  font-size: 16px;
}

button {
  margin-top: 12px;
  padding: 10px 14px;
  border: 0;
  border-radius: 10px;
  background: #2563eb;
  color: white;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  background: #94a3b8;
  cursor: not-allowed;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid #eef2f7;
  padding: 10px 0;
}

code,
pre {
  white-space: pre-wrap;
  word-break: break-all;
}
```

- [ ] **Step 5: Build web app**

Run:

```bash
pnpm --filter @youtube2podcast/web typecheck
pnpm --filter @youtube2podcast/web build
```

Expected:

- Typecheck passes.
- Vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat: add h5 conversion console"
```

## Task 11: Add local and Cloudflare setup documentation

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace README with setup guide**

`README.md`:

```md
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
```

- [ ] **Step 2: Run markdown sanity check**

Run:

```bash
sed -n '1,220p' README.md
```

Expected:

- README renders as a complete setup guide.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add setup guide"
```

## Task 12: End-to-end local verification with mock provider

**Files:**

- No new files required unless fixes are discovered.

- [ ] **Step 1: Run full checks**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected:

- All tests pass.
- Worker typecheck passes.
- Web typecheck passes.
- Web build succeeds.

- [ ] **Step 2: Start Worker locally**

Run:

```bash
pnpm dev:worker
```

Expected:

- Wrangler starts Worker on `http://localhost:8787`.

- [ ] **Step 3: Verify unauthorized API returns 401**

In another terminal:

```bash
curl -i http://localhost:8787/api/jobs
```

Expected:

```txt
HTTP/1.1 401 Unauthorized
```

- [ ] **Step 4: Verify RSS token behavior**

Run:

```bash
curl -i http://localhost:8787/rss/wrong.xml
```

Expected:

```txt
HTTP/1.1 404 Not Found
```

- [ ] **Step 5: Commit any fixes**

If the checks require code fixes:

```bash
git add apps README.md package.json pnpm-lock.yaml
git commit -m "fix: pass local mvp verification"
```

If no fixes are required, do not create an empty commit.

## Task 13: Real provider trial and production deployment

**Files:**

- Modify if needed: `wrangler.toml`
- Modify if needed: `README.md`

- [ ] **Step 1: Choose first real provider**

Use the provider that is easiest to test with a real API key. Recommended order:

1. Tunelio
2. YT2Mp3Converter
3. RapidAPI YouTube Audio provider

Decision rule:

- It must return a downloadable audio URL.
- It must support at least 30-60 minute interview videos.
- It should provide MIME type, duration, and file size, or allow the Worker to derive them from HTTP headers.

- [ ] **Step 2: Configure HTTP provider**

Set Cloudflare secrets:

```bash
wrangler secret put ADMIN_TOKEN
wrangler secret put RSS_TOKEN
wrangler secret put AUDIO_PROVIDER_API_KEY
```

Set `wrangler.toml` vars:

```toml
[vars]
AUDIO_PROVIDER = "http"
AUDIO_PROVIDER_ENDPOINT = "https://replace-with-provider-extract-endpoint"
PUBLIC_BASE_URL = "https://replace-with-worker-domain"
```

- [ ] **Step 3: Deploy Worker**

Run:

```bash
wrangler deploy
```

Expected:

- Worker deploys successfully.
- Deployment URL is printed.

- [ ] **Step 4: Deploy H5 console**

Use Cloudflare Pages with:

```bash
pnpm --filter @youtube2podcast/web build
```

Build output:

```txt
apps/web/dist
```

Environment variables:

```txt
VITE_API_BASE_URL=https://replace-with-worker-domain
VITE_PUBLIC_RSS_URL=https://replace-with-worker-domain/rss/<rss-token>.xml
```

- [ ] **Step 5: Run production acceptance test**

Use five videos:

- One under 10 minutes.
- One 30-60 minute interview.
- One 1-2 hour English interview.
- One duplicate of a successful video.
- One expected failure video.

Verify:

- Valid videos become completed episodes.
- Duplicate video does not call provider again.
- Expected failure shows an error and supports retry.
- RSS subscribes in Apple Podcasts.
- Lock screen playback works.
- Scrubbing works.
- `/media` supports `HEAD` and `Range`.

Commands for media checks:

```bash
curl -I "https://replace-with-worker-domain/media/<rss-token>/<episode-id>/audio"
curl -H "Range: bytes=0-99" -i "https://replace-with-worker-domain/media/<rss-token>/<episode-id>/audio"
```

Expected:

- `HEAD` returns `200 OK` with `Content-Length`.
- Range request returns `206 Partial Content`.
- Response includes `Accept-Ranges: bytes`.

- [ ] **Step 6: Commit deployment docs updates**

If provider-specific setup notes were added:

```bash
git add README.md wrangler.toml.example
git commit -m "docs: add provider deployment notes"
```

## Self-Review

Spec coverage:

- H5 console: Task 10.
- Worker API: Task 9.
- D1 schema and repositories: Task 3.
- Queues consumer: Task 8.
- AudioProvider abstraction: Task 4.
- RSS feed: Task 6.
- Protected media endpoint with HEAD/Range: Task 7.
- Token privacy: Tasks 2, 5, 7, 10.
- Manual retry: Task 9 and Task 10.
- Mock local verification: Task 12.
- Real provider and Apple Podcasts acceptance: Task 13.

Placeholder scan:

- Example replacement strings such as `replace-with-worker-domain` are configuration examples, not implementation gaps.
- The only non-frozen decision is the real third-party provider; the plan keeps it behind `HttpAudioProvider` and includes a concrete provider trial task.

Type consistency:

- `Env`, `ConversionMessage`, `EpisodeRecord`, `JobRecord`, `AudioProviderResult`, route names, and status names match across tasks.
