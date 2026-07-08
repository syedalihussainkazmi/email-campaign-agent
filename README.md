# MailPilot

AI-assisted email campaign manager. Connects to your Gmail account, lets you paste hundreds/thousands of recipients (auto-validated and deduped into chips), and sends personalized campaigns at a randomized, rate-limit-safe pace with live progress, pause/resume/cancel, campaign history, and an admin backend.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind, Prisma + PostgreSQL, NextAuth (Google OAuth), Vitest.

## Local Setup

1. **Database** — either run `docker compose up -d` (requires Docker) or point `DATABASE_URL` at any local/remote Postgres 16 instance.
2. Copy `.env.example` to `.env` and fill in values:
   - `DATABASE_URL` — your Postgres connection string.
   - `AUTH_SECRET` — any random 32+ byte string (`openssl rand -base64 32`).
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from a Google Cloud OAuth Client with the Gmail API's `gmail.send` scope enabled. Leave as placeholders if you just want to explore the UI.
   - `ENCRYPTION_KEY` — any random string, used to encrypt stored OAuth tokens at rest.
   - `EMAIL_SENDER` — `mock` (default) simulates sends so you can exercise the full campaign flow without Gmail credentials; set to `gmail` once real OAuth credentials are configured to send for real.
3. Install deps and migrate: `npm install && npm run db:migrate`.
4. `npm run dev` and open `http://localhost:3000`.

## Scripts

- `npm run dev` / `build` / `start`
- `npm run lint`
- `npm test` — Vitest unit tests (recipient parsing/validation, delay bounds, spam-score heuristic).
- `npm run db:migrate` / `db:generate` / `db:studio`

## Architecture

- `/app` — routes/layouts only; every route is thin and delegates to `/services`.
- `/components` — presentational UI, split by domain (`ui`, `campaign`, `admin`, `layout`).
- `/services` — reusable business logic (recipients, campaigns, Gmail, tokens, audit, admin queries). No framework code here.
- `/server` — the campaign send loop (`campaign-runner.ts`) and in-memory rate limiter.
- `/agents` — small rule-based assistants (spam-score hints, subject-line suggestions) — the seam to swap in a real LLM call later.
- `/auth` — NextAuth config, session helpers, admin guard.
- `/database` — Prisma client singleton + schema/migrations.
- `/actions` — Next.js server actions (form submissions) — thin wrappers over services.
- `/hooks`, `/store` — client-side progress polling and recipient-chip state.

### Swapping the mock sender for real Gmail

`services/email-sender.ts` exports an `EmailSenderPort` interface with two implementations: `MockEmailSender` (default) and `GmailEmailSender` (`services/gmail-service.ts`, fully wired against the Gmail API including token refresh and revocation handling). Set `EMAIL_SENDER=gmail` and supply real Google OAuth credentials — no other code changes needed.

### Campaign send flow

Pasting recipients runs through `services/recipient-service.ts` (regex extraction, normalization, dedup, validation) into a Zustand store that renders virtualized chips (`@tanstack/react-virtual`) so pasting 1000+ addresses stays smooth. Sending kicks off `server/campaign-runner.ts`, which sends one recipient at a time with a random 5-10s delay, persisting progress to Postgres after every send so state survives a refresh; the dashboard polls `/api/campaigns/[id]/progress` for the live bar, ETA, and current recipient. Pause/Cancel set a `controlFlag` column the runner checks between sends.
