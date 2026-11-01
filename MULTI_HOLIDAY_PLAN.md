# Multi-holiday neighborhood map plan

Status: implementation in progress, in tested increments committed and pushed to
main for the existing verification/deployment workflow.

## Implementation decisions

- Christmas 2026 runs November 1, 2026 through January 6, 2027, inclusive.
- Removal requests hide matched listings pending private manual review; durable
  preemptive requests also have a manual-review path.
- Privacy moderation uses a dedicated, manually assigned reviewer group, separate
  from neighborhood organizers. Membership can be expanded as operations grow.
- After API acceptance, removal must apply to subsequent public reads immediately
  and to open maps within 30 seconds. Already downloaded data cannot be recalled.
- Detailed resolved privacy requests are retained for 90 days; minimal suppression
  records remain until explicitly lifted.
- House collaboration uses manager/editor roles and expiring invitation links,
  with optional edition-specific access and no cross-house inheritance.
- New original holiday artwork, event-specific icons/emoji, markers, favicon,
  sharing metadata, and themes are part of the styling work.
- House invitations, access requests, and joint displays are in implementation
  scope, sequenced after the event and privacy foundation.
- Release progress and remaining limitations are recorded here; pushing a commit
  is not proof of a successful deployment.

## Release progress

- Event API foundation: explicit Halloween/Christmas editions, distinct status
  validation, explicit publication boolean, matching-year Halloween-only legacy
  reads, private selected-edition restoration, and date/isolation tests.
- Edition boundaries currently use America/Chicago as an explicit launch-region
  policy. Per-neighborhood timezone selection remains future work.
- Legacy routes remain available for old clients; this stage does not rewrite
  production records or claim to implement archive consent or household privacy.
- Holiday UI release: year-round display name, explicit edition selector, event
  links, Christmas/Halloween themes and markers, neutral favicon, new generated
  social artwork, explicit publication controls, and a private multi-house selector.
- Plan, event API, and holiday UI increments passed GitHub verification and
  deployment. The UI increment passed build, 166 tests, lint (one existing
  fast-refresh warning), and a 390x844 browser check, including event switching
  without horizontal overflow. Full resident collaboration,
  privacy workflows, historical publication, and joint displays remain pending.

## Goals and agreed defaults

Expand Candy Map into a year-round neighborhood celebration map, starting with
Christmas lights, while preserving Halloween participation.

- A house can participate in multiple holidays, but each event edition requires
  its own participation record. Claiming a house never publishes it.
- Community sightings of publicly visible decorations can be published after
  organizer review, clearly labeled as community-reported.
- Candy distribution, hosting, fireworks, and invitations require explicit
  resident consent. A sighting is not evidence of an invitation.
- Exact historical house pins require separate resident consent. Otherwise,
  history shows privacy-preserving neighborhood totals.
- Residents can remove their house or block future listings, including before
  anyone adds it. Blocking overrides every holiday and historical publication.
- Collaboration is explicit and scoped to a house, optionally restricted to an
  event edition. Sharing one house never shares access to another member's houses.
- Joint displays can group consenting houses for one event edition without merging
  properties, memberships, publication permissions, or privacy controls.

## Current foundation and changes needed

| Surface | Current behavior | Planned change |
| --- | --- | --- |
| [Shared domain](packages/shared/src/types.ts) | Houses, claims, candy participation, and reports are separate entities | Keep house/claim separation; introduce event editions, typed participation, submissions, and privacy controls |
| [Storage keys](services/api/src/lib/table.ts) | Participation key uses a calendar year | Key participation by house and explicit event edition |
| [Status updates](services/api/src/handlers/toggleCandyStatus.ts) | Candy-specific endpoint; six-hour default; public opt-in defaults to true | Explicit publication choice, event validation, and activity-specific schedules |
| [Public map API](services/api/src/handlers/getNeighborhoodHouses.ts) | Current-year, opted-in, unexpired, unfinished pins | Explicit event selection; distinct live and historical projections |
| [Resident claims](services/api/src/handlers/getMyClaims.ts) | Restores only current-year candy participation | Restore selected-event participation and private history independently |
| [Claims](services/api/src/handlers/submitClaim.ts), [approval](services/api/src/handlers/approveClaim.ts), [resident dashboard](apps/web/src/screens/ResidentDashboard.tsx) | Second claimant is disputed if another approved claim exists; approval can leave multiple approved claims; dashboard selects one claim | Explicit house memberships, invitations, multi-house selector, and separate disputes |
| [Community reports](services/api/src/handlers/reportHouse.ts) | Pending candy-status reports; no publication or queue workflow | Moderated decoration submissions plus separate status/correction reports |
| [House resolution](services/api/src/handlers/resolveHouse.ts) | Client-supplied address/location; full house response to signed-in callers | Trusted address matching, limited response fields, and suppression checks |
| [App shell](apps/web/src/App.tsx), [CSS](apps/web/src/index.css), [map rendering](apps/web/src/map/GoogleMap.tsx) | Halloween branding, candy labels, and hardcoded map colors | Neutral base design with event themes, accessible markers, and event-aware copy |

Existing organizer approval is not proof of residency or authority to consent to
publication. Existing records must not be promoted to stronger verification.

## 1. Event model and participation isolation

Use a small, extensible event catalog rather than building a general event
management platform immediately.

- **Event type:** Halloween, Christmas lights, Easter decorations, fireworks.
  Each defines supported activity details, labels, icons, and theme tokens.
- **Event edition:** a specific occurrence such as `halloween-2026` or
  `christmas-lights-2026`, with region/timezone, start/end instants, and lifecycle.
  Christmas display windows can span December into January without changing IDs.
- **House:** stable private location record. No holiday participation implied.
- **Claim:** authority to manage a house, independent of event participation.
- **House membership:** explicit `(houseId, userId)` access grant with a role,
  lifecycle, and optional event-edition restriction. An invitation is not proof
  that the recipient lives at the property.
- **Participation:** unique `(houseId, eventEditionId)` record with publication
  permission, provenance, activity-specific details, display/hosting windows,
  last confirmation, and separate archive consent.
- **Submission:** a private proposed sighting; approval produces or updates only
  the named edition's community-reported listing.
- **Suppression:** private address/property-level block, independent of whether
  a house record exists.

Separate event lifecycle (`upcoming`, `active`, `past`) from house availability.
Do not stretch candy's `available/low/finished` into decoration or fireworks
semantics. Lights can have a display date range and nightly viewing hours;
candy can keep its short availability window.

Every read/write must specify and validate the edition. Missing or invalid
editions produce explicit errors on new endpoints, not fallback to another event.
Reusing last year's settings creates a private draft requiring fresh confirmation.
Organizers may review sightings but cannot grant resident consent on someone's behalf.

## 2. Privacy and household blocking

Build this before enabling community publication.

### Publication and data minimization

- Public listings contain only event-specific pin identifiers, location precision
  allowed by the publication policy, activity/status, permitted viewing windows,
  and provenance. Never return names, emails, account/claim IDs, private address
  fields, consent records, or suppression records.
- Exact coordinates identify a property even without an address label. Do not
  describe a house map as anonymous or PII-free.
- For reviewed decoration sightings, allow a house-level pin only for visible
  outdoor displays, with clear notice and a prominent removal action. Approximate
  points are not guaranteed anonymity and must not shift a pin onto another home.
- Use event-specific public IDs to avoid unnecessary cross-holiday correlation.
- Keep free-form text and photo uploads out of the initial release. Add them only
  with moderation, redaction, metadata stripping, and retention controls.
- Limit private records to necessary address matching, consent, moderation, and
  abuse-prevention data. Restrict staff access and redact sensitive logs.
- Review existing Google Maps/Places data flows and storage terms; do not add
  external address-verification services without an explicit privacy decision.

### Remove or block my house

Provide a visible "Remove/block my house" entry point on the map, listing details,
and privacy page. An account must not be required to start a request.

1. Accept a private address selection, including addresses outside an existing
   neighborhood or not yet listed.
2. Support event-only unpublishing, removal from history, and "never list this
   property" across all events. Default the blocking workflow to the global option.
3. Hide a reported listing promptly while reviewing the request. A matched,
   approved resident can apply a durable block immediately.
4. Offer a low-data verification/review path for other requesters. GPS, a login,
   address knowledge, or organizer approval alone is not residency verification.
   Choose the exact method before implementation; do not require identity-document
   uploads in the MVP.
5. Rate-limit requests and review disputed claims to prevent arbitrary permanent
   suppression of neighbors. Do not automatically restore a contested listing;
   provide a documented escalation/appeal process.
6. Store a minimal suppression tombstone so deleting listing data cannot enable
   re-addition. Use server-side keyed address fingerprints, not a guessable plain
   address hash as a privacy guarantee; cover key rotation and matching changes.
7. Check suppression on house resolution, submission, approval, participation
   writes, and every public live/archive read. Use atomic write conditions and
   strongly consistent privacy checks where needed; a stale index must not expose
   a blocked property.
8. Remove pins from open clients on refresh and invalidate applicable server/CDN
   caches. Recompute archive aggregates when consent is withdrawn. Define and test
   a measurable removal propagation target before release.
9. Give submitters generic publication-unavailable responses rather than exposing
   whether an address is blocked, who requested it, or whether it was ever listed.

Normalize addresses server-side using trustworthy address/property matching.
Handle alternate spelling, provider changes, units, multi-household buildings,
and moved markers so a block cannot be bypassed with another neighborhood or pin.
Property-level versus unit-level authority needs an explicit rule before launch.

Distinguish deletion of personal/listing data from retention of the minimum block
record needed to honor "never list." Publish retention periods and reopening rules;
do not silently expire a durable block when an account is deleted.

## 3. Community contributions and moderation

- Require sign-in to submit sightings, not to browse or request removal.
- Ask for event edition, location, and structured visible-decoration details.
  Explain that submissions are reviewed and are not resident invitations.
- Dedupe against canonical houses and edition participation; keep reporter identity
  private. Do not create claims or grant household management rights to submitters.
- Add organizer queues for submissions, status reports, claims, and privacy
  escalations, with separate permissions and only necessary private fields.
- Record reviewer decisions and provenance. Re-check event validity, suppression,
  consent requirements, and conflicting resident updates at approval time.
- Resident preferences override community reports. Reports cannot silently change
  resident-confirmed participation or restore an unpublished house.
- Apply account-wide as well as per-house rate limits, duplicate detection, and
  escalation for abuse. Expire unreviewed/stale sightings according to event policy.
- Keep fireworks support to consented viewing/event information; do not infer
  hosting from a neighbor's observation or claim legality has been verified.

## 4. Live map, past holidays, and resident history

- Add an event/edition selector with Upcoming, Active, and Past grouping.
  Recommend Christmas after Halloween ends without silently changing a shared link.
- Display explicit local dates and lifecycle banners, such as
  "Halloween 2026 has ended." Past views never imply a house is currently open.
- Distinguish "scheduled display" from "confirmed on now"; nightly schedules are
  not evidence of present activity.
- Share links preserve neighborhood, edition, and live/history mode.
- Public archives show only separately consented house pins, labeled "Participated
  in this edition." Do not display old candy availability as a current status.
- Keep a private resident history of their own retained participation regardless
  of public archive consent, subject to deletion/retention settings.
- Show neighborhood-level participation totals where permitted; suppress small
  counts and revealing combinations. Choose thresholds before release.
- Preserve enough participation history to establish participation even after
  live expiry or "finished"; do not rely on transient live-map results or invent
  history from claims. Historical publication must still honor current blocks.

## 5. Styling and UX refresh

- Use a neutral year-round identity; retain Candy Map as the Halloween experience.
  Final app name is a separate product decision, not a migration prerequisite.
- Build a neutral base theme plus event-scoped CSS variables for accent, surface,
  border, and marker treatments. Keep status semantics separate from holiday color.
- Update header, selector, navigation, forms, empty/error states, marker tooltips,
  accessibility labels, legends, metadata, and sharing copy together.
- Replace relevant inline layout styles with shared component classes. Do not
  rewrite unrelated screens solely for cosmetic consistency.
- Use icons/shapes and text as well as color. Target WCAG AA contrast, visible
  focus, usable touch targets, reduced motion, and mobile map/list parity.
- Clearly distinguish resident-confirmed and community-reported listings, archived
  entries, and viewing versus hosting. Keep privacy actions easy to find.
- Account for Google Maps styling configuration as well as CSS; app theme tokens
  alone will not change the Google basemap.

## 6. Migration and compatibility

- Inventory retained data and back it up before migration. Dry-run with counts,
  collision checks, and consent/provenance checks.
- Convert each existing year-keyed candy participation into that year's Halloween
  edition only. Preserve expiry, status, timestamps, and existing publication
  choices; set new archive consent to false.
- Retain existing houses and claims without creating Christmas/Easter/fireworks
  participation. Missing participation stays missing.
- Existing consent cannot be upgraded into verified resident consent. Review
  legacy publication sources and grandfathering/renewal rules before cutover.
- Never reconstruct house history from claims alone or assume that every expired
  record proves a particular night's participation.
- Make migration idempotent and versioned, with a bounded compatibility period.
  If temporarily retaining the candy endpoint, map it only to Halloween and honor
  all new privacy rules; never use it as a generic current-holiday endpoint.
- Deploy compatible readers before writers, verify per-edition counts, then retire
  legacy keys/routes. Rollback must preserve new suppression and consent decisions,
  not restore an old reader that bypasses privacy controls.
- Map approved legacy claims to explicitly documented house access without
  inventing account relationships or stronger residency verification. Multiple
  approved claims need a safe authority review, not an arbitrary "first owner."

## 7. Shared house management

Include the basic collaboration flow in the Christmas release. Model access to a
property rather than a global family/account relationship; no relationship labels
or inferred household graph are needed.

### Current behavior

House resolution deduplicates matching canonical address keys, including common
address normalization and concurrent creation. This is not perfect property
matching: inconsistent units or provider-versus-fallback keys can still resolve
differently. Improve matching as part of the existing address/privacy work.

Accounts are independent. A second claim on a house with an approved claimant
becomes disputed; the existing claim is not replaced. An organizer can approve
another claim without removing the first, but there is no invitation, membership
role, or member-management workflow. The resident screen currently chooses one
claim even though storage can hold claims for multiple houses.

### Recommended workflow and permissions

- Add "Invite someone to help" to each managed house. Require an authorized house
  manager, recipient sign-in and explicit acceptance; never auto-connect accounts
  using an address, surname, location, network, or another shared property.
- Support two initial roles: **manager**, who manages members and applicable
  publication permissions, and **editor**, who updates activity details/status.
  Editors cannot invite others, grant publication/archive consent, remove managers,
  or lift a block. Membership alone does not establish authority to consent.
- Offer all-editions access for a house or access restricted to one edition.
  Neither scope creates participation or opts the house into future holidays.
- Use expiring, single-use, revocable invitations bound to house, role, scope and
  inviter. Store tokens hashed, keep them out of logs, and validate inviter rights
  again at acceptance. Acceptance must be atomic and idempotent.
- For an already registered house, offer "Request access" separately from
  "Dispute this claim." Do not expose existing member identities to requesters.
  Managers can accept requests or invite helpers; contested authority goes to review.
- Add a private "My houses" selector with separate members, participation, and
  invitation controls for each property. Clearly show which house and edition
  every update affects.
- Scope authorization server-side to the selected house and edition. Knowing a
  member or sharing another house never grants access. Revocation takes effect
  on the next request, including previously opened tabs.
- Allow leaving, removing editors, and transferring management through an explicit
  acceptance flow. Prevent accidental loss of the last active manager; provide a
  reviewed recovery route. An unresolved privacy request remains hidden and cannot
  be undone by another member's ordinary status update.
- Audit member, consent and participation changes privately. Use version checks
  for conflicting edits so stale screens cannot overwrite newer consent or blocks.

Example: accounts A and B both manage house H1. A helps with H2; B helps with H3.
A sees H1/H2 and B sees H1/H3. Neither gains access to H2/H3 through H1. An editor
invited for Christmas at H2 cannot change its Halloween participation.

## 8. Multi-house joint displays (later release)

Keep this out of the initial Christmas scope unless it becomes a launch requirement.
The house/edition foundation supports adding it without a global household entity.

- Add an event-scoped **display group** with a title, structured description,
  viewing schedule, coordinator memberships, and accepted house links.
- Every linked property's authorized manager explicitly accepts the link for that
  edition. Joining a group neither publishes a private house nor grants access to
  another house's members, settings, history, or invitations.
- Coordinators manage shared display information, not individual house authority.
  Each house keeps its own participation, consent, status, and archive choice.
- Show one display detail view with its permitted participating pins. Do not draw
  implied public access through private yards. For a shared fireworks location,
  identify one explicitly consented viewing/hosting location, not a duplicate show
  pin at every contributing house.
- Permit a house to leave independently. Blocking/unpublishing removes its pin
  and any revealing group references; the group cannot restore it. Suppress or
  revise shared content if it exposes a blocked property.
- Groups expire with their edition. Carrying a group to another holiday/year
  creates a draft and requires renewed house acceptance and publication consent.
- Keep group history subject to each house's archive permission. Aggregate counts
  must distinguish houses from displays to avoid double-counting.

## Delivery order and release gates

| Phase | Deliverable | Prerequisites / release gate |
| --- | --- | --- |
| 0 | Finalize event windows, address authority/verification, consent copy, retention, archive thresholds, removal target, and wireframes | Product/privacy decisions approved; no community auto-publication |
| 1 | Shared event/participation and house-membership models, explicit-event APIs, migration and authorization tests | Phase 0; existing Halloween behavior preserved without cross-event or cross-house leakage |
| 2 | Global suppression, removal intake/review, privacy projections and audit/caching rules | Phase 1; blocks survive re-addition, concurrency, deletion, and rollback |
| 3 | Christmas resident opt-in, viewing schedules, house invitations/selector, event selector and theme refresh | Phases 1-2; mobile/accessibility QA and deployed smoke tests |
| 4 | Community decoration submissions and operational moderation queues | Phases 2-3; staffed review/removal workflow, no publication before approval |
| 5 | Consent-aware public archives and private resident history | Phases 1-3; retention, aggregate privacy, and withdrawal tests |
| 6 | Easter and consented fireworks support | Core flow validated; activity-specific content and schedules tested |
| 7 | Event-scoped joint displays | Phases 2-4; per-house approval, withdrawal, privacy and non-duplicated show/count behavior verified |

Recommended first release: resident-added Christmas lights, refreshed styling,
house-specific invitations, and household blocking. Enable community sightings only once moderation and removal
workflows are operational. No photos, arbitrary custom events, or social profiles
are required for that release.

## Acceptance and validation

Use existing shared/API/web/infra tests; add focused cases for each phase and run
build, typecheck, lint, and full tests before release.

- A Halloween 2026 house never appears in Christmas 2026, Easter 2027, or Halloween
  2027 without a separate participation record and applicable publication permission.
- Claiming a house alone produces zero public pins.
- Shared-house membership never exposes another member's unrelated properties,
  identity relationships, or private records. Multi-house selection updates only
  the chosen house; edition-restricted editors cannot update other holidays.
- Invites expire, cannot be replayed or accepted after revocation/loss of inviter
  authority, and grant no publication permission by themselves. Stale sessions
  cannot write after membership removal.
- Group coordinators cannot alter individual house permissions. Group joining
  requires property-specific acceptance; blocks and archive withdrawals apply to
  group pins and shared content as well as standalone listings.
- Invalid/missing editions, mismatched activity details, and unauthorized updates
  fail explicitly. API and resident restoration always agree on selected edition.
- Christmas windows spanning January, local dates, midnight, daylight-saving
  changes, nightly schedules, expiry, and past-event boundaries behave correctly.
- Community submissions stay private until approved; hosting remains unpublished
  without resident consent; concurrent moderation cannot override a resident block.
- Blocking before creation prevents later publication through alternate address
  spellings, provider IDs, overlapping neighborhoods, and duplicate-resolution races.
- A block suppresses live/archive APIs and cached views within the chosen target;
  submitters cannot enumerate blocked addresses. It persists through account
  deletion, migration, backups/restore procedures, and rollback.
- Public response schemas omit private fields across every endpoint, including
  resolution and errors. Precise location risks are explained accurately in copy.
- Past editions never show live availability. House archives require separate
  consent; withdrawal removes pins and adjusts permitted aggregates.
- Event-specific deep links, map markers, list labels, keyboard navigation, contrast,
  and mobile resident/organizer/removal workflows pass automated and manual checks.
- Live failures remain visible; no synthetic houses or stale success-shaped
  fallback responses are shown.

## Decisions still needed before implementation

1. Christmas display dates and regional timezone policy.
2. Practical low-data residency/property-authority verification, reviewer account
   provisioning, escalation, and appeal policy. The dedicated reviewer-group model
   and manual-review MVP are approved.
3. Small-count archive thresholds and deletion/backup procedures. Resolved-request
   retention is 90 days, suppression lasts until explicitly lifted, and the
   open-map removal target is 30 seconds.
4. Unit/building blocking scope and a safe process for legitimate authority changes.
5. Final year-round name and visual direction; these can be chosen after wireframes.
6. Finalize management transfer/recovery rules and invitation delivery details.
   Manager/editor roles and expiring invitation links are approved. Joint displays
   are included after collaboration/privacy, not a prerequisite for the initial
   holiday release.
