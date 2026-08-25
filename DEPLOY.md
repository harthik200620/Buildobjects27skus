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
