# Candy Map

A mobile-first Halloween neighborhood candy map — proof of concept. Built per
[`COPILOT_PLAN.md`](./COPILOT_PLAN.md); see [`TASKS.md`](./TASKS.md) for the full milestone
checklist and known gaps.

Public visitors see which opted-in houses nearby are handing out candy right now, without
signing in. Residents sign in to claim their own house and toggle its status. Organizers approve
claims. Nothing here claims to verify identity or home ownership — a claim is always
`self_reported` until an organizer approves it.

## Architecture

```
apps/web            React + Vite + TS, mobile-first, MapLibre (demo tiles; swap-ready adapter)
services/api         Lambda handlers (Node 22, AWS SDK v3), one per endpoint
infrastructure       AWS CDK (TypeScript): DynamoDB, API Gateway HTTP API, Cognito, Lambda, IAM
packages/shared      Domain types + geo/address/authorization logic shared by web, api, and infra
```

Single-table DynamoDB design — see
[`services/api/src/lib/table.ts`](./services/api/src/lib/table.ts) for the full key schema and the
`gsi1` access patterns ("houses by neighborhood", "claims by user").

## Deployment steps

Requires an AWS account, the AWS CLI configured with credentials, and (once, per
account+region) `cdk bootstrap`.

```bash
# 1. Install dependencies and build the shared package (infra bundling needs its dist/ output)
npm install
npm run build --workspace packages/shared

# 2. One-time per AWS account/region
npx cdk bootstrap --app "npx ts-node --prefer-ts-exts infrastructure/bin/candy-map.ts"
# (or: cd infrastructure && npx cdk bootstrap)

# 3. Deploy — a real deployment MUST override both of these:
cd infrastructure
npx cdk deploy \
  --context allowedOrigin=https://your-deployed-web-origin \
  --context cognitoDomainPrefix=your-globally-unique-prefix

# 4. Note the stack outputs: ApiUrl, UserPoolId, UserPoolClientId, CognitoHostedUiDomain, TableName
```

Then configure the web app and deploy it (any static host — S3+CloudFront, Amplify Hosting, or
just `vercel`/`netlify` for the POC):

```bash
cd apps/web
cp .env.example .env.local
# Fill in VITE_API_BASE_URL (ApiUrl), VITE_COGNITO_DOMAIN (CognitoHostedUiDomain),
# VITE_COGNITO_CLIENT_ID (UserPoolClientId) from the stack outputs above.
npm run build
# deploy dist/ to your static host of choice
```

**Important:** `allowedOrigin` and the web app's deployed URL must match exactly (including
scheme), or Cognito will reject the OAuth callback and CORS will block API calls. Local dev
(`http://localhost:5173`) is always included as a fallback callback URL regardless of
`allowedOrigin`, so `npm run dev` works without a context override.

To seed the one demo neighborhood for a smoke test, call `POST /neighborhoods` (authenticated —
sign in via the Hosted UI first) with a small polygon, then `POST /houses/resolve` +
`POST /houses/claims` + `PATCH /houses/{id}/candy` as that same user. There is no seed script in
this POC; see "Known limitations" below.

## Environment variables

| App | Variable | Source |
|---|---|---|
| `apps/web` | `VITE_API_BASE_URL` | CDK output `ApiUrl` |
| `apps/web` | `VITE_COGNITO_DOMAIN` | CDK output `CognitoHostedUiDomain` |
| `apps/web` | `VITE_COGNITO_CLIENT_ID` | CDK output `UserPoolClientId` |
| `infrastructure` | `-c allowedOrigin=` | your deployed web origin (CORS + Cognito callback) |
| `infrastructure` | `-c cognitoDomainPrefix=` | must be globally unique per AWS region |
| `services/api` Lambdas | `TABLE_NAME`, `ALLOWED_ORIGIN` | set automatically by the CDK stack |

Without `apps/web`'s env vars, the app still runs fully in "fixture mode": the public map shows
static seed data and the resident/organizer screens show a clear "not configured yet" message
instead of broken buttons.

## AWS resources & cost cautions

- **DynamoDB**: on-demand (pay-per-request) billing, `RemovalPolicy.DESTROY` — the table (and all
  data) is deleted on `cdk destroy`. Fine for a POC; change to `RETAIN` before real data exists.
- **Lambda**: 9 functions, Node 22, default memory/timeout. Bundled with esbuild (no Docker
  required), ~1.3MB zipped each (dominated by the bundled AWS SDK v3 + Turf.js).
- **API Gateway HTTP API**: cheaper than REST APIs; default stage throttled to 20 req/s (40
  burst) — see `infrastructure/lib/candy-map-stack.ts`.
- **Cognito**: User Pool + Hosted UI domain. Cognito's free tier covers low MAU; `RemovalPolicy.
  DESTROY` on the pool too.
- Nothing here provisions Amazon Location Service, CloudFront, or Amplify Hosting — this POC uses
  MapLibre with a free demo tile style and leaves static web hosting to whatever you prefer.
- **Run `cdk destroy` when done experimenting** — nothing in this stack is a "set it and forget
  it, no ongoing cost" resource; DynamoDB on-demand and Lambda are usage-based, but the Cognito
  user pool and API Gateway stage exist whether or not they're used.

## Known limitations

See [`TASKS.md`](./TASKS.md) "Known gaps / unfinished acceptance criteria" for the full,
up-to-date list. Highlights:

- **No real geocoder.** `POST /houses/resolve` trusts a client-supplied lat/lon instead of
  geocoding a street address (Amazon Location Service place search was deferred per the plan's
  guidance to use a documented mock adapter rather than block the POC on service setup).
- **No "list pending claims/reports for a neighborhood" endpoint.** The organizer screens take a
  claim id as manual input because COPILOT_PLAN.md's API contract never defines a listing
  endpoint — only point-lookups by id.
- **Single-region, single-cell spatial locking and scan-based candidate search.** Explicitly
  allowed by the plan for this POC ("POC may scan one small regional set"); documented in
  `packages/shared/src/geo.ts` and `services/api/src/lib/neighborhoodLock.ts` as needing a real
  geohash/S2 index and multi-cell locking before scaling past one region.
- **No deployment has actually been run** against a real AWS account in this session (no
  credentials available) — `cdk synth` and all unit/integration tests pass, but nothing below
  that has been exercised end-to-end on real infrastructure. Treat the smoke-test checklist below
  as unverified until someone runs it post-deploy.
- Map tiles come from MapLibre's public demo style (`demotiles.maplibre.org`), explicitly intended
  for testing/demos only — swap for a licensed tile provider or Amazon Location Service before any
  real usage.
- No QR code image; a copyable share link (`?lat=&lon=`) covers the same acceptance criterion.
- No mobile device lab was available in this session — only desktop browser automation was used
  to verify the mobile-first layout renders; a real device pass is still needed.

## Manual smoke-test checklist

Run after deploying (see "Deployment steps"). Each line maps to an acceptance criterion in
`COPILOT_PLAN.md`.

1. [ ] Open the deployed web app on two different phones/browsers at the same share link —
   both show the same neighborhood boundary and the same active candy pins.
2. [ ] Sign in as Resident A, submit a house address whose point falls **outside** the seeded
   neighborhood's polygon — expect a 422 rejection, not a created house.
3. [ ] Resolve the same address twice (e.g. retry after a network blip) — expect the second call
   to return the *same* house id, not a duplicate.
4. [ ] Propose a new neighborhood whose boundary is ~85%+ coincident with an existing one —
   expect a 409 pointing at the existing neighborhood, not a second one created.
5. [ ] Propose a neighborhood with partial (~10–80%) overlap — expect it to be created with
   `status: "pending_review"`, not `"active"`, and not auto-merged into the existing one.
6. [ ] As Resident A (no approved claim), call `PATCH /houses/{id}/candy` on a house claimed by
   Resident B — expect 403, not a status change.
7. [ ] Call `GET /neighborhoods/{id}/houses` and confirm the response never contains an address,
   claimant user id, email, or name — only `id`, `point`, `status`, `updatedAt`.
8. [ ] Toggle a house to `finished`, or let its `expiresAt` pass — confirm it disappears from the
   public houses list on the next poll.
9. [ ] Submit two claims on the same unclaimed house back-to-back (simulating concurrent
   claimants) — confirm the DynamoDB item never ends up with a silently-overwritten approved
   claimant; the loser should be `disputed`, not have erased the winner.
10. [ ] Check CloudWatch Logs / the DynamoDB console for any ID images, GPS history, or
    children's-identity-shaped data — there should be none; this POC never collects any.
