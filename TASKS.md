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
- [ ] `infrastructure`: CDK app — DynamoDB tables (Neighborhood, House, Membership, Claim,
      Participation, Report, Audit), API Gateway HTTP API, Lambda functions, least-privilege IAM
- [ ] `services/api`: `GET /neighborhoods?lat=&lon=`, `GET /neighborhoods/{id}/houses` (opted-in,
      active only; no PII)
- [ ] `POST /neighborhoods` validation: closed/non-self-intersecting polygon, reasonable area,
      inside supported region (server-side, using `packages/shared`)
- [ ] Web app fetches from the real public API instead of static fixtures (adapter-based, so it
      still falls back to fixtures if API is unreachable)
- [ ] Unit tests for Lambda handlers (mocked DynamoDB)

## Milestone 3 — Auth, claims, candy toggle
- [ ] Cognito User Pool (CDK) + JWT verification in Lambda/API Gateway authorizer
- [ ] `POST /houses/resolve`, `POST /houses/claims`, `PATCH /houses/{id}/candy`, `GET /me/claims`
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
