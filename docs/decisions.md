# Architecture decisions

Short ADRs so later phases stay consistent. Dates: Phase 1, November 2026.

## ADR-001 — npm workspaces monorepo

**Context:** one repo for mobile, admin, API and docs.
**Decision:** npm workspaces (`server`, `apps/*`), TypeScript everywhere, shared
`tsconfig.base.json`, one root ESLint/Prettier config. Metro is configured for the
monorepo per Expo's guide.
**Consequences:** one `npm install`; hoisted dependencies; no publishing. If native
module resolution becomes painful, switch mobile to its own lockfile without touching
the API.

## ADR-002 — Money as integer paise

**Context:** deposits, fines and platform fees must never drift by rounding.
**Decision:** all monetary columns and API payloads use integer **paise**; formatting
to ₹ happens in the UI only. Never `Float`/`Decimal` for money arithmetic.
**Consequences:** divide by 100 at the edges; test money logic with integers.

## ADR-003 — Ledger-first wallet with cached balances

**Context:** audits, disputes and payouts need an immutable money trail.
**Decision:** `LedgerTransaction` groups balanced `LedgerEntry` rows (debits = credits).
`Wallet.availablePaise` and `heldPaise` are caches updated in the same DB transaction.
Deposits sit in `USER_HELD`; every operation carries an `idempotencyKey`.
**Consequences:** balances can be rebuilt from the ledger; a reconciliation job is
required in Phase 6/11.

## ADR-004 — PostGIS via Unsupported + raw SQL

**Context:** Prisma cannot express GiST indexes or `geography` operations.
**Decision:** `Listing.location Unsupported("geography(Point, 4326)")` plus
`prisma/sql/postgis.sql` for the extension and indexes. Nearby search uses
`ST_DWithin` through `$queryRaw` (Phase 3).
**Consequences:** location writes go through raw SQL and must set both `location` and
`latitude`/`longitude`.

## ADR-005 — KYC data minimisation

**Context:** Aadhaar handling is regulated (Aadhaar Act, DPDP Act 2023, SPDI Rules).
**Decision:** store only the last 4 digits, an HMAC hash for duplicate detection, and
the provider reference. Document images go to private encrypted storage with
short-lived signed URLs. Mask in UI and logs. Access is admin-only and audited.
**Consequences:** support cannot "look up" an Aadhaar number; re-verification goes
through the provider.

## ADR-006 — Provider interfaces, mock first

**Context:** KYC, e-sign, payments and storage vendors need real contracts and money.
**Decision:** `KycProvider`, `EsignProvider`, `PaymentProvider`, `StorageProvider`
interfaces with a mock implementation in dev; real adapters plug in later without
touching domain logic.
**Consequences:** no vendor lock-in; integration tests run against mocks.

## ADR-007 — Append-only audit

**Context:** disputes and legal escalation need trustworthy history.
**Decision:** `ContractEvent`, `LedgerEntry` and `AuditLog` are insert-only.
`AuditLog` is hash-chained (`hash = SHA-256(prevHash + payload)`); admin actions are
separately recorded in `AdminAction`.
**Consequences:** no destructive edits; corrections are compensating entries/events.

## ADR-008 — Versioned REST API with `/api/v1`

**Context:** the mobile app will ship on users' phones and cannot be force-updated.
**Decision:** all routes under `/api/v1`; breaking changes go to `/api/v2`, additive
fields only within v1. Errors use a single envelope: `{ error: { code, message,
details?, requestId? } }`.
**Consequences:** mobile clients can ignore unknown fields safely.

## ADR-009 — Never hold real funds without a regulated partner

**Context:** holding deposits in India requires a PA-PG/PPI licence or a regulated
escrow/route partner.
**Decision:** the wallet is an internal ledger; Razorpay (Route/escrow) or a licensed
partner will custody real money. `PaymentProvider` isolates that integration.
**Consequences:** README and UI must describe deposits as "held in-app subject to
partner escrow", and go-live requires legal review.

## ADR-010 — Legal features facilitate, they do not litigate

**Context:** e-sign, notices and evidence packs touch Indian evidence law
(BSA 2023 / earlier Evidence Act, IT Act 2000).
**Decision:** Level 1 e-consent always; Level 2 Aadhaar eSign above a configurable
value threshold. Evidence packs and notice templates are drafts for a licensed
advocate; Section 63 BSA certificate is a template the user signs.
**Consequences:** clear disclaimers in app and docs; no auto-filing of cases.

## ADR-011 — Phone OTP + rotating refresh-token families (Phase 2)

**Context:** India-first product, so phone OTP is the primary factor; passwords and
SMS costs are both risks.
**Decision:** 6-digit OTP, HMAC-SHA256 hashed with a server-side pepper
(`OTP_PEPPER`), 5 attempts, 5-minute TTL, 30-second resend cooldown and 5 sends/hour
per phone (plus per-IP limits). Login returns a 15-minute HS256 access JWT and an
opaque 384-bit refresh token. Only the SHA-256 of the refresh token is stored; every
login creates a `familyId`, and each refresh rotates the token inside a transaction.
Reusing a rotated token revokes the whole family and writes an audit event.
**Consequences:** access-token revocation is delayed by at most 15 minutes, but role,
status and KYC state are read from the DB on every request. Tokens are stored in
Expo SecureStore on mobile. Cookies/BFF are deferred until the admin gets a same-site
deployment. Strict single-use rotation means a refresh response lost in transit looks
like reuse and signs the user out of that session family; this is the intended
security trade-off, and the mobile client retries API calls only once.

## ADR-012 — Consent records and deletion grace period (Phase 2)

**Context:** DPDP Act 2023 requires demonstrable, purpose-bound consent and a
time-bound response to erasure requests.
**Decision:** `ConsentRecord` is insert-only and versioned (`purpose`, `version`,
`granted`, IP, UA). KYC submission writes a `KYC_VERIFICATION` consent row in the
same transaction as the document. `DELETE /me` sets `deletionRequestedAt` and revokes
all sessions; the account remains recoverable for 30 days, then a Phase 14 job scrubs
PII while retaining financial/legal records.
**Consequences:** consent history is auditable but cannot be "edited" — withdrawal is
a new row (or deletion request). Users must sign in again to cancel a deletion.

## ADR-013 — Admin web sessions in memory + sessionStorage (Phase 2)

**Context:** the admin SPA is served from a different origin in development and there
is no BFF yet; httpOnly cross-site cookies need a same-site deployment and CSRF work.
**Decision:** the admin stores the refresh token in `sessionStorage` and keeps the
access token in memory; tokens are cleared on sign-out. Only numbers in
`ADMIN_PHONES` are promoted to `ADMIN` at login, and every `/admin/*` route checks the
role from the database.
**Consequences:** sessionStorage is readable by XSS, so the admin must move to
httpOnly cookies + CSRF protection before production. MFA and IP allow-listing are
Phase 14 requirements, not optional polish.
