# Borrow Circle

Peer-to-peer equipment lending and borrowing for India. Neighbours lend tools,
construction gear, farming equipment, electronics and event kit; borrowers take
them for a fixed period under a digital contract with a security deposit held in
the app.

- **Lender** — owns the item, lends it out.
- **Borrower** — takes the item temporarily.
- A QR-verifiable **digital contract** and a **deposit hold** protect both sides.

> **Status: Phase 2 of 15 complete.** Monorepo, PostGIS data model, phone-OTP auth
> with rotating refresh tokens, profile, KYC submission/review and DPDP consent +
> deletion flows. Listings, contracts, wallet and legal tooling follow phase by
> phase. No real SMS or KYC vendor is connected yet — both are behind mock providers.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Mobile | React Native + Expo SDK 58 (TypeScript), React Navigation, Zustand (later) |
| Admin | React + Vite (TypeScript) |
| API | Node.js + Express (TypeScript), REST + Socket.io (Phase 4) |
| Database | PostgreSQL 16 + PostGIS, Prisma ORM |
| Auth | Phone OTP, HS256 access JWT + rotating opaque refresh tokens |
| Payments | Razorpay (test mode) behind a `PaymentProvider` (Phase 6) |
| Storage | Cloudinary/S3 behind a storage provider (Phase 3) |
| Tooling | npm workspaces, ESLint 9 flat config, Prettier, Docker Compose |

## Repository layout

```
borrow-circle/
  apps/
    mobile/            Expo React Native app
      src/api.ts       Typed API client, secure session storage, auto-refresh
      src/auth.tsx     Auth context (restore session, sign in/out)
      src/screens/     Phone, OTP and Home (profile + KYC)
    admin/             React + Vite admin dashboard
      src/api.ts       Admin API client (sessionStorage refresh token)
      src/App.tsx      OTP login, KYC queue, approve/reject panel
  server/
    prisma/
      schema.prisma    Full data model
      sql/postgis.sql  Extension + GiST/trigram indexes
    src/
      config/env.ts    Zod-validated environment
      lib/             Prisma, pino, crypto, JWT, audit chain, phone helpers
      middleware/      Auth/role guards, async wrapper, rate limits, errors
      services/        Auth, profile, KYC + mock SMS/KYC providers
      routes/          /auth, /me, /admin routers
      app.ts           Express app factory
      index.ts         Entrypoint + graceful shutdown
  docs/
    API.md             Conventions + endpoint map per phase
    decisions.md       Architecture decision records
    er-diagram.md      ER diagram + contract state machine
  docker-compose.yml    PostGIS database
```

---

## Prerequisites

- Node.js **22.13+** (required by Expo SDK 58 / React Native 0.88) and npm 10+
- Docker Desktop (or Docker Engine + Compose v2)
- Optional: Expo Go on your phone for the mobile shell
- A bash-capable terminal (macOS/Linux, WSL, or Git Bash on Windows)

## Setup

Run from the `borrow-circle/` directory.

```bash
# 1. Environment files
cp .env.example .env
cp server/.env.example server/.env
# Replace the secrets/peppers in server/.env with generated values
# (run once per value: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, OTP_PEPPER,
# IDENTITY_HASH_PEPPER — the peppers and JWT secrets must all differ):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Then set ADMIN_PHONES to the mobile number(s) that should get admin access,
# e.g. ADMIN_PHONES=+919999999999 (your number must be in E.164 format).

# 2. Install all workspaces
npm install

# 3. Start Postgres 16 + PostGIS
npm run db:up

# 4. Create the schema (first migration)
npm run db:generate
npm run db:migrate -w @borrow-circle/server -- --name init

# 5. Add PostGIS/pg_trgm extensions and spatial indexes
npm run postgis:index

# 6. Run the API
npm run dev            # http://localhost:4000
```

Verify the API:

```bash
curl http://localhost:4000/health
# {"status":"ok","uptimeSeconds":1}
curl http://localhost:4000/health/ready
# {"status":"ready","database":"up"}
```

Then, in separate terminals:

```bash
npm run dev:admin      # http://localhost:5173  (shows API up/down)
npm run dev:mobile     # Expo dev server, press a/i or scan the QR
```

> If Expo warns about dependency versions, run
> `npx expo install --fix` inside `apps/mobile`. Pin alignment is handled there
> rather than in the workspace root.

### Resetting the local database

```bash
npm run db:reset       # drops the volume and recreates an empty database
npm run db:migrate -w @borrow-circle/server -- --name init
npm run postgis:index
```

If you already migrated the Phase 1 schema, create an incremental migration for the
Phase 2 tables instead of resetting:

```bash
npm run db:migrate -w @borrow-circle/server -- --name auth_kyc_consent
```

## Phase 2: auth, profile and KYC

### Try it locally

1. Start the API (step 6 above). For the mobile app, copy
   `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL`
   (use your machine's LAN IP when testing on a physical phone), then run
   `npm run dev:mobile`.
2. Enter your phone number and tap **Send code**. With the default
   `EXPOSE_DEV_OTP=true` in development, the app shows the 6-digit code on the OTP
   screen (the API also returns it as `devCode`). The code is HMAC-hashed in the
   database and is never logged.
3. After verifying, edit your profile and submit KYC.
   - **Mock KYC rule:** an Aadhaar number ending in an even digit is verified
     instantly; odd Aadhaar, PAN and driving licence submissions go to
     `PENDING` for admin review.
   - Only the last four digits plus an HMAC are stored; the full number is discarded.
4. Admin review: open `http://localhost:5173`, sign in with a number listed in
   `ADMIN_PHONES`. Pending documents appear under **Pending**; open one to approve
   or reject with a reason. Reviewing your own document is blocked.

### API smoke test (curl)

```bash
# 1. Request a code (devCode is returned only outside production)
curl -s -X POST http://localhost:4000/api/v1/auth/otp/request \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+919999999999"}'
# {"otp":{"sent":true,"expiresInSeconds":300,"resendAfterSeconds":30,"devCode":"123456"}}

# 2. Verify it
curl -s -X POST http://localhost:4000/api/v1/auth/otp/verify \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+919999999999","code":"123456"}'

# 3. Use the accessToken from the response
curl -s http://localhost:4000/api/v1/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Account deletion

`DELETE /api/v1/me` schedules erasure 30 days out and revokes every session. Sign in
again and call `POST /api/v1/me/deletion/cancel` to keep the account. The actual PII
scrub job lands in Phase 14; until then the request is recorded and audited.

### What is still mocked

- **SMS:** `MockSmsProvider` logs a masked phone and withholds the code; plug a real
  provider into `server/src/services/providers/sms.ts`.
- **KYC:** `MockKycProvider` returns deterministic decisions; the real DigiLocker/
  Digio/Signzy adapter replaces it behind the same interface.
- **Images:** KYC accepts opaque `kyc/...` storage keys; uploads and signed URLs are
  Phase 3. An admin-only image viewer is Phase 10.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API in watch mode |
| `npm run dev:admin` | Admin dashboard (Vite, port 5173) |
| `npm run dev:mobile` | Expo dev server |
| `npm run build` | Compile API and admin |
| `npm run typecheck` | TypeScript across workspaces |
| `npm run lint` / `lint:fix` | ESLint 9 flat config |
| `npm run format` / `format:check` | Prettier |
| `npm run db:up` / `db:down` / `db:reset` | Docker database lifecycle |
| `npm run db:migrate` | `prisma migrate dev` |
| `npm run db:studio` | Prisma Studio |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run postgis:index` | Apply `server/prisma/sql/postgis.sql` |

## Data model conventions

- **Money is integer paise** (`rentPerDayPaise`, `depositPaise`, …). Never floats.
- **Wallet is ledger-first**: `LedgerTransaction` groups balanced `LedgerEntry`
  rows; `Wallet.availablePaise`/`heldPaise` are caches. Deposits live in
  `USER_HELD` until release or forfeit.
- **KYC minimisation**: full Aadhaar is never stored — only last 4 digits + HMAC
  hash + provider reference. Images belong in encrypted private storage.
- **Location**: PostGIS `geography(Point,4326)` on `Listing.location`, with
  lat/lng mirrored for simple pins. GiST index in `prisma/sql/postgis.sql`.
- **Audit**: `ContractEvent`, `LedgerEntry` and `AuditLog` are append-only;
  `AuditLog` is hash-chained. Admin actions also land in `AdminAction`.

See [`docs/er-diagram.md`](docs/er-diagram.md) and
[`docs/decisions.md`](docs/decisions.md).

## Security baseline

Implemented in Phases 1–2:

- Zod-validated env; refuses to boot on missing/short secrets, and rejects
  identical JWT secrets or localhost CORS origins in production.
- Helmet security headers, strict CORS allow-list, 1 MB JSON body limit.
- Global API rate limiting (300 req/min/IP) plus OTP/refresh-specific limiters.
- Central error envelope with request IDs; stack traces hidden in production.
- Structured pino logging with PII/token/OTP redaction.
- `.env*` and key material excluded from git; no secrets in the repo.
- Phone OTP: codes stored as HMAC-SHA256 with a server pepper, 5 attempts, short TTL,
  per-phone cooldown/hourly cap, per-IP limits, single-use enforcement.
- Refresh tokens: 384-bit random, SHA-256 hash at rest, family rotation, reuse
  detection revokes the family and writes an audit event.
- Role/status/KYC read from the database on every request; suspended/banned users are
  blocked immediately and admin routes require `role = ADMIN`.
- KYC minimisation: full Aadhaar/PAN never persisted, duplicate detection via HMAC,
  consent version recorded, admin review blocks self-approval.
- Hash-chained append-only `AuditLog` now written for auth, profile, deletion, KYC and
  admin decisions, serialised with a Postgres advisory lock.
- Dev OTP exposure is hard-disabled in production regardless of env flags.

Not yet implemented (later phases): MFA, field-level encryption, signed URLs, upload
scanning, certificate pinning, fraud detection, WAF, Sentry, CI scanning, admin
httpOnly-cookie sessions.

## Assumptions made in Phase 1

1. Node 20+, npm workspaces; no pnpm/yarn.
2. Local Postgres is the `postgis/postgis:16-3.4` container (user `borrow` is a
   superuser locally, which lets the migration create PostGIS).
3. Expo SDK 58 (React Native 0.88, React 19.3) is the baseline for the mobile shell.
4. API uses CommonJS output (`tsc`); dev uses `tsx` watch. Mobile/admin are ESM.
5. Money in paise, dates in UTC, rental periods as `YYYY-MM-DD`.
6. Contract PDF/SHA-256, e-sign providers and Razorpay are stubbed behind interfaces
   in later phases; no real money moves in this build.
7. Category seed data and default settings (`Setting` rows) arrive in Phase 3/6.

Phase 2 assumptions:

8. SMS and KYC are mock providers; the dev OTP is returned in the API response
   (`EXPOSE_DEV_OTP=true`) and shown in the mobile/admin UI. Never enable it in prod.
9. There is no image upload endpoint yet — KYC accepts storage keys under `kyc/` and
   the admin viewer is deferred; the review UI reports whether images are attached.
10. Admin accounts are bootstrapped from the `ADMIN_PHONES` env allow-list; there is no
   admin invite/role-management UI until Phase 10. Admin sessions use sessionStorage
   and memory (see ADR-013) and must move to httpOnly cookies before production.
11. Account deletion only records the request + audit event; the erasure job and PII
   scrub are Phase 14. Financial records must be retained where law requires.
12. Access tokens last 15 minutes; role/status changes apply immediately because they
   are read from the database, but a stolen access token stays valid until expiry.

## Legal and compliance notes

These are product constraints, not legal advice:

- **Holding funds** (deposits, wallet balances) in India needs a regulated
  partner — Razorpay Route/escrow, a PA-PG or PPI licence. The wallet here is an
  internal ledger behind a swappable `PaymentProvider`.
- **Aadhaar/PAN handling** must follow the Aadhaar Act, DPDP Act 2023 and SPDI
  Rules: consent, minimisation, encryption, retention limits, breach reporting.
- **E-signature strength**: Level 1 in-app consent is convenient but weaker
  evidence; Level 2 Aadhaar eSign via a licensed ESP is required above the
  configured replacement-value threshold.
- **Legal notices, recovery claims and evidence packs** are templates and
  evidence tooling only. The platform does not file cases or guarantee outcomes;
  users must consult a licensed advocate.

## Next up — Phase 3

Listings and discovery: create/edit listings with photos, PostGIS nearby search,
categories, availability and public listing pages, plus the storage provider for
uploads (which also unblocks real KYC image review).
