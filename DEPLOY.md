# Deploy — local → AWS is a config change

Every runtime dependency sits behind an environment variable; the only code seam the lift touches is
`MediaStore` (`services/pipeline/src/media/store.ts`), which already has an S3 implementation.

## Local (today)

```bash
pnpm install
pnpm infra:up            # MySQL 8 · Meilisearch · Redis (docker compose -f infra/docker-compose.yml up -d on machines with Docker)
pnpm db:migrate && pnpm db:seed
pnpm registry:seed       # categories, brands, the 9 attribute registries (calendar sheet → bulbs)
pnpm pipeline run        # 27 SKUs end to end (curated fixtures; live with ANTHROPIC_API_KEY)
pnpm assets:3d           # placeholder GLBs + manifest
pnpm dev                 # http://localhost:3000  (phone: any 10 digits · OTP 000000)
```

## Environment diff

| Key | Local | AWS |
|---|---|---|
| `DATABASE_URL` | `mysql://root:buildo@localhost:3306/buildobjects` | RDS MySQL 8 endpoint (same dump: `mysqldump buildobjects \| mysql -h <rds>`) |
| `MEILI_HOST` / `MEILI_MASTER_KEY` | `http://localhost:7700` / `buildo-local` | Meilisearch container on ECS/EC2 behind an internal ALB, or Meilisearch Cloud URL + key |
| `REDIS_URL` | `redis://localhost:6379` | ElastiCache (Redis 7) endpoint |
| `MEDIA_STORE` | `local` | `s3` |
| `MEDIA_ROOT` | `./storage/media` | — (unused with `s3`) |
| `S3_BUCKET` / `S3_REGION` | — | `buildobjects-media` / `ap-south-1` (+ standard AWS credentials on the task role) |
| `MEDIA_BASE_URL` · `NEXT_PUBLIC_MEDIA_BASE_URL` | `/media` | `https://<cloudfront-domain>` (origin = the S3 bucket; keys are content-addressed → `immutable` caching) |
| `ASSETS_3D_ROOT` | `../../assets/3d` | mount or sync `assets/3d` to the web task, or serve it from the same bucket under `3d/` |
| `SESSION_SECRET` | dev value | a 32+ byte random secret |
| `ANTHROPIC_API_KEY` | empty → curated fixtures | set → live extraction / verification / fill / descriptions / drawing reader |
| `GEMINI_API_KEY` | empty → on-device scene read + overlay composite | set → Gemini scene understanding + generative composite |
| `QUEUE_DRIVER` | `auto` | `bullmq` |
| `PIPELINE_CONCURRENCY` | 6 | per worker task; scale tasks, not threads |

Copy `.env.example` → `.env` and fill the right-hand column. Nothing else changes.

## Render, with the database (one Blueprint)

`render.yaml` in the repository root brings up the store and a MySQL 8.4 server that keeps its data.

1. Render dashboard → **New → Blueprint** → connect `harthik200620/Buildobjects27skus` → **Apply**.
2. Render creates `bo-mysql` (private service, 5 GB disk) and `bo-web` (the store), generates the
   root password and the session secret, and wires the web service to the database by its private
   hostname. Nothing is pasted by hand; nothing secret is in the repository.
3. First boot runs `pnpm db:bootstrap`, which waits for MySQL, restores
   `infra/seed/buildobjects.sql.gz` into the empty database — 37 categories, 27 SKUs, 135 images,
   1,498 specifications — and applies the Drizzle migrations. Later boots see the catalogue is
   already there and do nothing.

**What it costs.** Render's free instances cover web services and Postgres only; private services
and disks are paid, and MySQL here is a private service with a disk. That is about **$7/month for
the database, $1.25 for its disk, and $7 for the web service**. Setting `bo-web` to `plan: free`
saves the last $7 at the price of a ~50 second wake-up after 15 idle minutes. The database cannot
be free at any price — if that matters more than keeping MySQL, the alternative is Render Postgres
and a port of `packages/db` off `drizzle-orm/mysql-core`.

**The connection string is assembled, not stored.** A Blueprint can hand one service another
service's hostname and another service's generated password, but it cannot concatenate them into a
URL. So `databaseUrl()` (`packages/db/src/client.ts`) composes `DATABASE_URL` from `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` when `DATABASE_URL` itself is unset. Everywhere
else — local, AWS, anything with a connection string — is unchanged.

**What is not in this Blueprint.** No Meilisearch and no Redis: each would be another paid private
service, search falls back to the frozen catalogue in `apps/web/data/catalogue` (28 documents,
filtered in memory), and the only queue work is the pipeline, which runs on a laptop. To add
Meilisearch later, add a third `pserv` on `getmeili/meilisearch:v1.15` with a disk, set `MEILI_HOST`
and `MEILI_MASTER_KEY` on `bo-web`, and run `pnpm pipeline derive` against it.

**The catalogue dump.** `pnpm db:dump` regenerates `infra/seed/buildobjects.sql.gz` from the local
database. It writes schema for all twenty tables and rows for the fourteen catalogue ones —
`users`, `sessions`, `otp_challenges`, `estimates` and the pipeline's ingest log are structure
without data, because those rows are one developer's and the file is in a public repository. The
script warns if anything in the output still looks like a phone number.

**If a deploy misbehaves.** MySQL restarting under load means 512 MB is not enough — raise
`bo-mysql` to `plan: standard`. A build that dies without an error is usually the same thing on the
web service. `curl https://<app>/api/health` reports `mysql: up|down` with the driver's own message.

## Components

- **MySQL → RDS MySQL 8** (`utf8mb4_0900_ai_ci`). `pnpm db:migrate` runs the Drizzle migrations against the new URL. EAV + read-model sizing at 400k SKUs: ~25 M small rows + 400k JSON rows → db.r6g.large is ample; reads never touch EAV.
- **Media → S3 + CloudFront.** `MEDIA_STORE=s3` switches the pipeline's `MediaStore`; the web app only knows `MEDIA_BASE_URL + key`. Sync the local store once: `aws s3 sync storage/media s3://buildobjects-media --cache-control "public,max-age=31536000,immutable"`.
- **Meilisearch → same image on ECS Fargate (persistent EFS volume) or Meilisearch Cloud.** Re-index with `pnpm pipeline derive`. 400k docs ≈ 1–2 GB on disk.
- **Redis → ElastiCache.** BullMQ needs `maxRetriesPerRequest: null` (already set).
- **Web → Vercel or ECS.** `pnpm --filter @buildobjects/web build && pnpm --filter @buildobjects/web start`. ISR revalidation webhook: `POST /api/revalidate` with `x-revalidate-secret: $SESSION_SECRET` after each pipeline run.
- **Pipeline workers → ECS scheduled tasks / services** running `pnpm --filter @buildobjects/pipeline worker` (N tasks drain one queue); `pnpm pipeline run` from a one-off task enqueues and derives.

## Verify after the lift

```bash
curl -s https://<app>/api/health          # mysql: up · meilisearch: up · providers
pnpm scale:test --base https://<app>      # §12.1 budgets against the deployed stack
pnpm --filter @buildobjects/web lighthouse --base https://<app>
```
