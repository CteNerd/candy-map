# Candy Map — web app

React + Vite + TypeScript, mobile-first. See the [repo root README](../../README.md) for
deployment steps and environment variables.

```bash
npm run dev          # local dev server at http://localhost:5173
npm run build         # production build (tsc -b && vite build)
npm run test           # vitest
npm run lint            # oxlint
```

Without `VITE_API_BASE_URL`/`VITE_COGNITO_*` set (see `.env.example`), the app runs in "fixture
mode": the public map renders static seed data and the resident/organizer screens show a
"not configured yet" message instead of broken sign-in buttons.
