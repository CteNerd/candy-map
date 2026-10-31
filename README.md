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

## Deployment

- Live app: [Candy Map](https://d20cdlbs8tmt1h.cloudfront.net)
- Repository: [CteNerd/candy-map](https://github.com/CteNerd/candy-map)
- Deployment region: `us-east-1`.

Requires Node 22+, npm, AWS CLI v2, and an existing AWS GitHub OIDC provider
(`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`). All commands below
run from the repository root. No AWS access keys are stored in GitHub.

### One-time privileged setup

Use the approved setup profile only to provision `CandyMapDeployment`; do **not** run the
standard `cdk bootstrap`, which defaults to AdministratorAccess for CloudFormation.
Our isolated bootstrap creates an asset bucket, version parameter, four deployment roles,
and three project policies. It does not modify the account's existing CDKToolkit, OIDC provider,
users, credentials, or other apps.
It supports this app's file assets only, not arbitrary CDK/container deployments. CDK's generic
"bootstrap outdated" notice refers to its version-6 compatibility parameter; do not replace it
with an administrator-backed default bootstrap to silence that notice.

```bash
npm ci
AWS_ACCOUNT_ID=YOUR_ACCOUNT AWS_REGION=us-east-1 \
  GITHUB_REPOSITORY=OWNER/REPO node scripts/setup-deployment.mjs

aws configure set role_arn arn:aws:iam::YOUR_ACCOUNT:role/candy-map/deployment/candy-map-local-deploy --profile candy-map
aws configure set source_profile default --profile candy-map
aws configure set region us-east-1 --profile candy-map
AWS_PROFILE=candy-map aws sts get-caller-identity
```

If setup uses a different source profile, set `source_profile` accordingly. The source identity
must be able to assume the new local role. Existing admin permissions on that source remain
unchanged; the `candy-map` sessions themselves use only project permissions. For eliminating
stored admin credentials altogether, migrate the source to IAM Identity Center separately.

### Deploy with project permissions

```bash
AWS_PROFILE=candy-map AWS_REGION=us-east-1 npm run deploy
```

`npm run deploy` defaults to the `candy-map` profile when no credentials/profile are supplied,
and rejects administrator identities even if they are explicitly selected.

This builds shared code first, deploys `CandyMapHosting` and `CandyMapStack`, reads CloudFormation
outputs, builds the frontend with the public API/Cognito settings, publishes hashed assets before
HTML, invalidates CloudFront, waits for invalidation, and checks live web/API responses.
Previous hashed assets are retained so open tabs continue working during a release.

The private S3 bucket is served through CloudFront HTTPS with SPA deep-link routing. Its origin
is automatically used for API CORS and Cognito `/auth/callback`; no manual second deployment or
wildcard CORS is needed. The Cognito domain prefix defaults to account+region. Local development
still has a callback at `http://localhost:5173/auth/callback`; fill in the public variables in
`apps/web/.env.local` from backend outputs to use the deployed API locally.

After the first successful deployment, use the setup identity **once more** to restrict generated
API, Cognito, distribution and origin-access-control IDs (instead of their initial wildcards):

```bash
AWS_ACCOUNT_ID=YOUR_ACCOUNT AWS_REGION=us-east-1 \
  GITHUB_REPOSITORY=OWNER/REPO node scripts/setup-deployment.mjs --tighten
```

The scope values persist as CloudFormation parameters. Replacing any of these generated resources
requires an intentional privileged setup change; ordinary code deployments do not.

### IAM scope and GitHub Actions

- Local and GitHub roles assume `candy-map-cdk-deploy`; CDK passes only
  `candy-map-cloudformation` to CloudFormation. Deployment permissions cover only the two app
  stack names, project asset/web buckets, version parameter, and this CloudFront distribution.
- CloudFormation can manage only named project tables, functions, buckets and runtime-role paths.
  IAM role creation must attach the project permissions boundary; `iam:PassRole` is restricted
  to project runtime roles and Lambda. The boundary permits only project DynamoDB reads/writes
  and project Lambda logs, so an inline runtime policy cannot grant IAM/admin access.
- Some AWS operations cannot be scoped to an existing ARN (resource creation, Cognito domain
  lookup, CloudFormation template validation/listing, API Gateway tagging). These retain necessary
  service-specific permissions; generated resource CRUD scopes are tightened after provisioning.
  Trusted deployers can create new resources within those services, but have no AdministratorAccess.
- GitHub trust requires the exact repository's `production` environment and the STS audience.
  Configure that environment's deployment branch policy to permit only `main`.
- Set environment variables `AWS_ACCOUNT_ID`, `AWS_REGION`, and `AWS_DEPLOY_ROLE_ARN` (the
  `GitHubDeployRoleArn` setup output). They are identifiers, not secrets.
- The workflow verifies builds, tests and lint on PRs and main. Only verified main pushes or manual
  runs on main deploy via OIDC. npm downloads are cached; deployments serialize and are never
  cancelled halfway through. PR jobs have no AWS credentials.

The live database starts empty, deliberately without publishing synthetic houses as real data.
To create the first neighborhood, sign in, then call authenticated `POST /neighborhoods` with
a small polygon. The creator becomes its organizer. Claim houses via the resident screen;
approve them via the organizer screen using `<houseId>::<claimantUserId>`. Neighborhood creation
and moderation queues still lack complete UI; see limitations below.

## Environment variables

| App | Variable | Source |
|---|---|---|
| `apps/web` | `VITE_API_BASE_URL` | CDK output `ApiUrl` |
| `apps/web` | `VITE_COGNITO_DOMAIN` | CDK output `CognitoHostedUiDomain` |
| `apps/web` | `VITE_COGNITO_CLIENT_ID` | CDK output `UserPoolClientId` |
| `infrastructure` | `-c allowedOrigin=` | optional override; CloudFront origin is automatic |
| `infrastructure` | `-c cognitoDomainPrefix=` | optional override; defaults to account+region |
| `services/api` Lambdas | `TABLE_NAME`, `ALLOWED_ORIGIN` | set automatically by the CDK stack |

Without `apps/web`'s env vars, the app still runs fully in "fixture mode": the public map shows
static seed data and the resident/organizer screens show a clear "not configured yet" message
instead of broken buttons.

## AWS resources & cost cautions

- **DynamoDB**: on-demand billing, deletion protection and `RemovalPolicy.RETAIN`.
- **Lambda**: 9 functions, Node 22, default memory/timeout. Bundled with esbuild (no Docker
  required), ~1.3MB uncompressed bundles (dominated by the bundled AWS SDK v3 + Turf.js).
- **API Gateway HTTP API**: cheaper than REST APIs; default stage throttled to 20 req/s (40
  burst) — see `infrastructure/lib/candy-map-stack.ts`.
- **Cognito**: User Pool + Hosted UI domain, retained and deletion-protected.
- **S3 + CloudFront**: private retained buckets, CDN requests/transfer and invalidations have usage
  charges; no custom domain, certificate, WAF or Amazon Location resources are provisioned.
  MapLibre still uses a public demo tile provider.
- No budget alarm or spend cap is configured. Monitor usage before publicizing the app.
  Removal is intentionally privileged/manual: app deployment roles cannot delete stacks, and
  retained data/auth/buckets are not removed by stack deletion.

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
- **The full resident/organizer flow still needs real user QA.** Live HTTP smoke checks verify
  deployment plumbing, not address validity, home ownership, claim races or moderation workflows.
  No real geocoder, moderation queue or neighborhood-creation UI is included yet.
- Map tiles come from MapLibre's public demo style (`demotiles.maplibre.org`), explicitly intended
  for testing/demos only — swap for a licensed tile provider or Amazon Location Service before any
  real usage.
- No QR code image; a copyable share link (`?lat=&lon=`) covers the same acceptance criterion.
- Browser smoke checks passed at a 390x844 mobile viewport with a working hosted map worker
  and no horizontal overflow. Cognito's sign-in redirect was exercised, but no real account
  sign-in/claim/approval flow or physical-device pass has been completed.

### Deployment verification

- Both app CloudFormation stacks completed successfully using the local project role.
- Live HTTPS, public API array responses, exact-origin CORS, SPA callback routing and unsigned
  request rejection passed.
- All three resolved IAM policies passed AWS policy validation. Permission simulation rejected
  unrelated stacks, distributions, functions, user pools and IAM roles.
- 111 tests pass, including loading all nine real bundled Lambda handlers in Node.

## Manual smoke-test checklist

Run after deploying (see "Deployment"). Each line maps to an acceptance criterion in
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
