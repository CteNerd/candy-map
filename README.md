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
apps/web            React + Vite + TS, mobile-first, Google Maps + Places address search
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

Requires Node 22+, npm, AWS CLI v2, authenticated GitHub CLI for setup, and an existing AWS GitHub OIDC provider
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
still has a callback at `http://localhost:5173/auth/callback`, but API CORS intentionally permits
only the deployed origin. Local development uses fixtures by default; connecting localhost to
the live API also requires an explicit development CORS configuration.

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
  Setup reads the repository's actual subject prefix through GitHub CLI, including immutable
  owner/repository IDs when enabled; it does not assume the legacy name-only subject format.
  Configure that environment's deployment branch policy to permit only `main`.
- Set environment variables `AWS_ACCOUNT_ID`, `AWS_REGION`, and `AWS_DEPLOY_ROLE_ARN` (the
  `GitHubDeployRoleArn` setup output). They are identifiers, not secrets.
- The workflow verifies builds, tests and lint on PRs and main. Only verified main pushes or manual
  runs on main deploy via OIDC. npm downloads are cached; deployments serialize and are never
  cancelled halfway through. PR jobs have no AWS credentials.

The live database starts empty, deliberately without publishing synthetic houses as real data.
Choose **Add neighborhood**, sign in, search or locate your area, and tap boundary corners in
order. Name and save the neighborhood; its creator becomes its organizer. Choose **Associate my
house**, search the house address, select the neighborhood, and confirm the marker inside its
boundary. Claims remain self-reported until approved. The pending-claim card links to the organizer
approval screen with its claim ID filled in; only that neighborhood's organizer can approve it.
After approval, return to Resident and explicitly select a candy status to opt into the public map.
Overlapping neighborhoods may be pending review and cannot be selected in the active-neighborhood
house workflow until activated. A review queue/activation UI is still missing.

## Environment variables

| App | Variable | Source |
|---|---|---|
| `apps/web` | `VITE_API_BASE_URL` | CDK output `ApiUrl` |
| `apps/web` | `VITE_COGNITO_DOMAIN` | CDK output `CognitoHostedUiDomain` |
| `apps/web` | `VITE_COGNITO_CLIENT_ID` | CDK output `UserPoolClientId` |
| `apps/web` | `VITE_GOOGLE_MAPS_API_KEY` | Google Maps Platform restricted browser key |
| `apps/web` | `VITE_GOOGLE_MAPS_MAP_ID` | Google Maps Platform JavaScript map ID |
| `infrastructure` | `-c allowedOrigin=` | optional override; CloudFront origin is automatic |
| `infrastructure` | `-c cognitoDomainPrefix=` | optional override; defaults to account+region |
| `services/api` Lambdas | `TABLE_NAME`, `ALLOWED_ORIGIN` | set automatically by the CDK stack |

Without API settings, public data uses clearly local fixtures and mutations cannot save. Google
Maps still requires its key and map ID; missing settings show an explicit map error.

### Google Maps and local development

Enable **Maps JavaScript API** and **Places API (New)** in a billing-enabled Google Cloud project.
Create a **JavaScript / Vector** map ID. Restrict the browser key to those APIs and to the deployed
website; use a separate development key allowing `http://localhost:5173/*`. Browser keys are public
in compiled assets even when supplied from GitHub secrets. Configure provider quotas and billing
alerts before launch; alerts are not spending caps.

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the five public configuration
values. The local file is gitignored. Run `npm run dev:web` and restart after changing environment
settings. The dev server binds to port 5173 (no silent port fallback, since key restrictions and
Cognito callbacks depend on it). With a live API URL configured, Vite proxies `/api` to that API
for same-origin local requests; production builds call the API directly. **Local writes affect the
configured live database**. No production CORS expansion is needed. Cognito must allow the local
`http://localhost:5173/auth/callback` URL (already included by this stack).

In GitHub's **production** environment, store `VITE_GOOGLE_MAPS_API_KEY` as a secret and
`VITE_GOOGLE_MAPS_MAP_ID` as a variable. The deployment workflow supplies them to the build.
Local `npm run deploy` requires both Google settings exported in its environment; it does not
automatically read the frontend `.env.local`.

The public map uses a shared-link location first; otherwise it automatically locates only if
browser permission is already granted. **Use my location** requests permission explicitly.
Search an address, or pan and choose **Search this area**, to load nearby neighborhoods. Location
denial/timeouts and map/search failures are visible. Address search retrieves only location and
address components; it does not establish house ownership.

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

- **No server-side address verification.** Google Places supplies address/location suggestions
  in the UI, but `POST /houses/resolve` still trusts client-confirmed address fields and coordinates.
  A claim is not proof of ownership or address validity.
- **No "list pending claims/reports for a neighborhood" endpoint.** The organizer screens take a
  claim id as manual input because COPILOT_PLAN.md's API contract never defines a listing
  endpoint — only point-lookups by id.
- **Single-region, single-cell spatial locking and scan-based candidate search.** Explicitly
  allowed by the plan for this POC ("POC may scan one small regional set"); documented in
  `packages/shared/src/geo.ts` and `services/api/src/lib/neighborhoodLock.ts` as needing a real
  geohash/S2 index and multi-cell locking before scaling past one region.
- **The full resident/organizer flow still needs real user QA.** Live HTTP smoke checks verify
  deployment plumbing, not address validity, home ownership, claim races or moderation workflows.
  Neighborhood creation and Google address search are implemented; a moderation queue is not.
- Google Maps and Places require valid restricted browser configuration, billing and enabled APIs.
  Automated browser/map/search traffic can incur provider charges; application rate limits do not
  directly limit requests to Google.
- No QR code image; a copyable share link (`?lat=&lon=`) covers the same acceptance criterion.
- Earlier MapLibre browser smoke checks passed at a 390x844 mobile viewport with a working hosted map worker
  and no horizontal overflow. Cognito's sign-in redirect was exercised, but no real account
  sign-in/claim/approval flow or physical-device pass has been completed.

### Deployment verification

- Both app CloudFormation stacks completed successfully using the local project role.
- Live HTTPS, public API array responses, exact-origin CORS, SPA callback routing and unsigned
  request rejection passed.
- All three resolved IAM policies passed AWS policy validation. Permission simulation rejected
  unrelated stacks, distributions, functions, user pools and IAM roles.
- 111 tests pass, including loading all nine real bundled Lambda handlers in Node.
- [GitHub Actions verification and OIDC deployment](https://github.com/CteNerd/candy-map/actions/runs/41238984449)
  completed successfully: verification took 1m06s and deployment took 1m46s.

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
