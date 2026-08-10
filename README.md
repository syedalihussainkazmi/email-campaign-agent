# MailPilot

AI-assisted email campaign manager, by DevXtech. Sign in directly with any webmail account (cPanel, Zoho Mail, Titan, Gmail's own SMTP, etc.) — no Google account required. Connect as many mailboxes as you want, paste hundreds/thousands of recipients (auto-validated and deduped into chips), and let the built-in deliverability planner tell you how to safely split the send across your accounts before anything goes out. Sends run at a randomized, rate-limit-safe pace with live progress, pause/resume/cancel, a full per-campaign recipient breakdown, campaign history, and an admin backend.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind, Prisma + PostgreSQL, nodemailer (SMTP), Vitest.

## Local Setup

1. **Database** — either run `docker compose up -d` (requires Docker) or point `DATABASE_URL` at any local/remote Postgres 16 instance.
2. Copy `.env.example` to `.env` and fill in values:
   - `DATABASE_URL` — your Postgres connection string.
   - `ENCRYPTION_KEY` — any random string, used to encrypt stored SMTP passwords at rest.
3. Install deps and migrate: `npm install && npm run db:migrate`.
4. `npm run dev` and open `http://localhost:3000`.
5. On the landing page, sign in with your webmail: email, password, SMTP host, and port. Credentials are verified against the real SMTP server before an account is created — nothing is saved on failure.
6. Add more accounts anytime in **Settings → Email Accounts**.

## Scripts

- `npm run dev` / `build` / `start`
- `npm run lint`
- `npm test` — Vitest unit tests (recipient parsing/validation, delay bounds, spam-score heuristic, send-planner).
- `npm run db:migrate` / `db:generate` / `db:studio`

## Architecture

- `/app` — routes/layouts only; every route is thin and delegates to `/services`.
- `/components` — presentational UI, split by domain (`ui`, `campaign`, `admin`, `layout`, `auth`, `brand`).
- `/services` — reusable business logic (recipients, campaigns, SMTP accounts, send planning, tokens, audit, admin queries). No framework code here.
- `/server` — the campaign send loop (`campaign-runner.ts`) and in-memory rate limiter.
- `/agents` — small rule-based assistants (spam-score hints, subject-line suggestions) — the seam to swap in a real LLM call later.
- `/auth` — session reader (cookie + DB lookup, no OAuth provider), admin guard.
- `/database` — Prisma client singleton + schema/migrations.
- `/actions` — Next.js server actions (form submissions) — thin wrappers over services.
- `/hooks`, `/store` — client-side progress polling and recipient-chip state.

### Auth

Sign-in is 100% webmail/SMTP-credential-based — no OAuth, no third-party account required. `actions/webmail-auth-actions.ts` verifies the given SMTP credentials against the real server first (proving ownership), then creates/finds a user and a database session directly. `auth/session.ts` reads that session straight from the cookie + `Session`/`User` tables, with no signing/JWT involved.

### Multi-account sending & the deliverability planner

An account can connect as many `SmtpAccount` rows (Settings → Email Accounts) as it wants — each with its own host/credentials and a `mailboxAgeStartDate` the account's warm-up status is calculated from. `services/send-planner.ts` is a pure, side-effect-free module that computes:

- **`capForAge(ageDays)`** — a safe daily send ceiling that ramps up as a mailbox ages (10/day at day 0 → 25 → 50 → 75 → 100/day at 60+ days), overridable per account.
- **`buildSendPlan(recipientCount, accounts, template)`** — splits a campaign's recipients across the accounts you check in the Send Plan panel (shown live above the Send button), respecting each account's remaining daily capacity, warning if the volume exceeds today's total capacity (spread over N days instead) or if the template has no personalization tokens (a spam-risk signal independent of volume).

Each `CampaignRecipient` snapshots its assigned `smtpAccountId` and `scheduledFor` day at creation time — the runner only processes recipients whose day has arrived, resolving the sender per-recipient since different recipients in the same campaign may go through different accounts.

### Campaign send flow

Pasting recipients runs through `services/recipient-service.ts` (regex extraction, business/owner name parsing, normalization, dedup, validation) into a Zustand store that renders virtualized chips (`@tanstack/react-virtual`) so pasting 1000+ addresses stays smooth. Sending kicks off `server/campaign-runner.ts`, which sends one recipient at a time with a random 5-10s delay, persisting progress to Postgres after every send so state survives a refresh; the dashboard polls `/api/campaigns/[id]/progress` for the live bar, ETA, and current recipient. Pause/Cancel set a `controlFlag` column the runner checks between sends. Every campaign has a full detail page (`/history/[id]`) showing aggregate stats and each individual recipient's status.

A campaign whose recipients are spread across multiple days pauses once today's batch is done and resumes via `app/api/campaigns/resume-scheduled` — that route needs an external periodic ping (a cron job, a scheduled task, or just revisiting the app) to actually fire on a schedule.
