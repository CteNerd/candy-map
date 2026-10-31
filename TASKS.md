# Candy Map — Build Tasks

Source of truth: `COPILOT_PLAN.md` (brief provided by the user). This file tracks milestones and
is kept updated as work proceeds. Anything not completed is listed explicitly in "Known gaps /
unfinished acceptance criteria" at the bottom — nothing is silently dropped.

## Milestone 1 — Scaffold (vertical slice: static map + seeded neighborhood)
- [x] Monorepo layout: `apps/web`, `services/api`, `infrastructure`, `packages/shared`
- [x] Root workspace config, base `tsconfig`, `.gitignore`
- [x] `packages/shared`: core types + geo utils (address normalization, polygon validation,
      overlap/containment, point-in-polygon) with unit tests (37 passing)
- [x] `apps/web`: Vite + React + TS scaffold, mobile-first layout, map adapter (MapLibre, with
      documented swap point for Amazon Location Service), one seeded neighborhood polygon + static
      seeded candy pins rendered from local fixture data
- [x] Build passes for web app (typecheck, vite build, 8 vitest smoke/unit tests, lint clean;
      manually verified in-browser: boundary polygon, 4 pins, and all 4 nav screens render)

## Milestone 2 — Public API (read path)
- [x] `infrastructure`: CDK app — single-table DynamoDB (Neighborhood, House, Membership, Claim,
      Participation, Report, Audit all in one table + `gsi1`), API Gateway HTTP API, 2 Lambda
      functions, least-privilege IAM (verified via `cdk synth` + CDK assertions tests: 1 table, 2
      functions, 2 routes, IAM policies scoped to exactly Scan/Query/GetItem — no write actions)
- [x] `services/api`: `GET /neighborhoods?lat=&lon=`, `GET /neighborhoods/{id}/houses` (opted-in,
      active only; no PII — returns `PublicNeighborhood`/`PublicHousePin` projections)
- [x] Polygon validation logic (closed/non-self-intersecting, reasonable area, inside supported
      region) — implemented and unit-tested in `packages/shared` (Milestone 1); reused server-side
      by the `POST /neighborhoods` handler once it's wired up below
- [ ] `POST /neighborhoods` endpoint itself: deliberately **deferred to Milestone 3/4**, alongside
      the Cognito organizer authorizer and overlap-dedupe reservation — an unauthenticated,
      dedupe-free create endpoint would violate "every write checks authorization server-side" and
      "prevent duplicate neighborhood creation." The plan's own Hour 4 note explicitly allows
      cutting "automated neighborhood creation" before cutting authorization/privacy.
- [x] Web app fetches from the real public API instead of static fixtures (adapter-based, so it
      still falls back to fixtures if API is unreachable) — already supported by `lib/api.ts`
      (Milestone 1); set `VITE_API_BASE_URL` once the stack is deployed to switch over
- [x] Unit tests for Lambda handlers (mocked DynamoDB via `aws-sdk-client-mock`, 6 passing)

## Milestone 3 — Auth, claims, candy toggle
- [ ] Cognito User Pool (CDK) + JWT verification in Lambda/API Gateway authorizer
- [ ] `POST /houses/resolve`, `POST /houses/claims`, `PATCH /houses/{id}/candy`, `GET /me/claims`
- [ ] `POST /neighborhoods` (authenticated organizer, structural validation wired to the
      authorizer; overlap-dedupe still pending until Milestone 4)
- [ ] House dedupe: canonical address key, `HOUSE_KEY#<hash>` reservation item, atomic
      `TransactWriteItems`
- [ ] Resident dashboard screen (claim + toggle status) gated behind sign-in
- [ ] Organizer approval endpoint `POST /admin/claims/{id}/approve` + minimal organizer screen

## Milestone 4 — Duplicate-neighborhood checks, reports, hardening
- [ ] Neighborhood overlap check (>=0.8 block, >=0.1 review queue) using bbox/grid candidates +
      Turf intersection, both directions (new/existing)
- [ ] Neighborhood-creation reservation keyed by coarse spatial cell (conditional write, TTL) to
      prevent simultaneous duplicate creation — single-cell POC, documented limitation for
      multi-cell production locking
- [ ] `POST /houses/{id}/reports` (authenticated, rate-limited, pending moderation; not published)
- [ ] API throttling / per-account-per-house rate limiting
- [ ] Mobile QA pass, deployment docs, QR/share-link for a neighborhood
- [ ] Additional integration tests (conditional-write race, claim conflicts, duplicate
      neighborhood reservation, public response shape)

## Known gaps / unfinished acceptance criteria
_(This section is updated as implementation proceeds; see bottom of README for final status.)_
