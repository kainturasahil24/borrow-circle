# API plan and conventions

Base URL: `http://localhost:4000/api/v1` (local). OpenAPI/Swagger is planned for a
later phase; this document is the source of truth until then.

## Conventions

- **Auth:** `Authorization: Bearer <access JWT>`; short-lived access token, rotating
  refresh token. Role guard for `/admin/*`, plus per-resource ownership checks.
- **Errors:** `{ "error": { "code": "SNAKE_CASE", "message": "...", "details": {}, "requestId": "..." } }`
- **Success:** resource JSON at the top level; list endpoints use
  `{ "data": [...], "page": { "cursor": "...", "hasMore": true } }`.
- **Money:** integer paise in every request/response (`depositPaise`, `rentPerDayPaise`).
- **Idempotency:** money-mutating `POST`s require `Idempotency-Key`.
- **Dates:** ISO-8601 UTC timestamps; rental dates as `YYYY-MM-DD`.
- **Rate limits:** 300 req/min/IP globally; stricter limits per auth/OTP/payment route.
- **Privacy:** masked Aadhaar (`XXXX XXXX 1234`), masked PAN, no PII in logs.

## Endpoint map by phase

### Phase 2 — Auth, profile, KYC, admin KYC

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/otp/request` | phone; rate-limited, no user enumeration |
| POST | `/auth/otp/verify` | returns access + refresh tokens, device-bound |
| POST | `/auth/refresh` | rotation + reuse detection |
| POST | `/auth/logout` | revoke session family |
| GET | `/me` | profile + KYC status + trust signals |
| PATCH | `/me` | name, photo, address, city |
| POST | `/me/kyc/documents` | type + last4 + image refs; consent recorded |
| GET | `/me/kyc` | status per document (masked) |
| DELETE | `/me` | data-deletion request workflow |
| GET | `/admin/kyc?status=PENDING` | review queue, cursor paginated |
| GET | `/admin/kyc/:id` | single document + masked user summary |
| POST | `/admin/kyc/:id/decision` | `{ decision: "APPROVE" \| "REJECT", reason? }`, audited |
| POST | `/auth/logout-all` | revoke every session family for the user |
| GET | `/auth/sessions` | active sessions for the signed-in user |
| DELETE | `/auth/sessions/:familyId` | revoke one session |
| POST | `/me/deletion/cancel` | cancel a scheduled deletion inside the grace window |

#### Phase 2 payloads

`POST /auth/otp/request` → `{ "otp": { "sent": true, "expiresInSeconds": 300,
"resendAfterSeconds": 30, "devCode": "123456" } }`. `devCode` is present only when
`EXPOSE_DEV_OTP=true`, `NODE_ENV !== "production"` and the SMS provider is `mock`.
The response is identical for registered and new numbers.

`POST /auth/otp/verify` and `POST /auth/refresh` →

```json
{
  "accessToken": "eyJ…",
  "refreshToken": "4f9c…",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": "…", "phone": "+9198…", "role": "USER", "kycStatus": "NOT_STARTED" },
  "isNewUser": false
}
```

`POST /auth/otp/verify` accepts an optional `device: { fingerprint, platform?,
appVersion?, pushToken? }`. `POST /auth/logout` takes `{ refreshToken }` and always
returns `{ "revoked": true }`.

`POST /me/kyc/documents` accepts `{ type: "AADHAAR" | "PAN" | "DRIVING_LICENCE",
number, consentVersion, holderName?, frontImageKey?, backImageKey?, selfieImageKey? }`.
Image keys must be opaque storage keys under `kyc/`. The response contains the masked
document plus the derived account status; the full number is never stored or returned.

`DELETE /me` → `202 { "deletion": { "requestedAt": "…", "scheduledFor": "…" } }`
with a 30-day grace period. `POST /me/deletion/cancel` → `{ "deletion": null }`.

`GET /admin/kyc` → `{ data: [...], page: { nextCursor, hasMore, limit }, status }`.
Admin decision errors: `SELF_REVIEW_FORBIDDEN`, `DOCUMENT_ALREADY_REVIEWED`,
`REASON_REQUIRED`.

### Phase 3 — Listings & discovery

`POST/GET/PATCH/DELETE /listings`, `POST /listings/:id/photos`,
`GET /listings/nearby?lat=&lng=&radiusKm=&category=&minPrice=&maxPrice=`,
`GET /categories`.

### Phase 4 — Chat & offers

`GET /threads`, `GET /threads/:id/messages`, `POST /threads/:id/messages`,
`POST /threads/:id/offers`, `POST /offers/:id/accept|decline`,
`POST /users/:id/block`, `POST /reports`. Socket.io namespace `/chat`.

### Phase 5 — Contracts

`POST /contracts` (from accepted offer), `POST /contracts/:id/sign`,
`GET /contracts/:id`, `GET /contracts/:id/pdf`, `POST /contracts/:id/cancel`,
`GET /contracts/verify/:token` (public QR verification).

### Phase 6 — Wallet & payments

`GET /wallet`, `POST /wallet/top-up`, `POST /payments/razorpay/order`,
`POST /payments/razorpay/webhook`, `POST /payments/:id/cash-confirm`,
`GET /wallet/transactions`, `POST /wallet/withdrawals`.

### Phase 7 — Handover, return, disputes

`POST /contracts/:id/photos` (pickup/return, min 3, geotag+hash),
`POST /contracts/:id/return-decision`, `POST /contracts/:id/disputes`,
`GET/POST /admin/disputes[/:id/decision]`.

### Phase 8 — Calendar & jobs

`GET /calendar`, `POST /contracts/:id/renewals`, `POST /renewals/:id/decision`.
Scheduled: reminders, overdue ladder, fine accrual.

### Phase 9 — History, reviews, feedback

`GET /history`, `GET /history/statement.pdf`, `POST /contracts/:id/reviews`,
`POST /feedback`, `GET /announcements`.

### Phase 10+ — Admin, legal, security

`GET /admin/analytics`, `/admin/users`, `/admin/settings`, `/admin/feedback`,
`/admin/announcements`, `/admin/audit-log`, `/admin/legal/*`, `/admin/evidence/*`.
