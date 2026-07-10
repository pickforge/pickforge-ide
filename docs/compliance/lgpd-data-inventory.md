# LGPD Data Inventory

Internal compliance artifact. This is the source of truth the public Privacy
Policy and Terms of Service derive from. If the product changes, update this
file first, then reconcile `docs/legal/privacy.*` and `docs/legal/terms.*`.

Draft — pending owner review and review by a Brazilian lawyer before anything
built on it is published. Refs: pickforge/pickforge#155.

## Roles (LGPD)

- **Titular** (data subject): the person using PickForge.
- **Controlador** (controller): the entity that decides how and why personal
  data is processed. [OWNER: legal entity name and CNPJ, or your full name and
  CPF if operating as an individual.]
- **Operadores** (processors): third parties that process data on the
  controller's instructions — Supabase, Stripe, OpenAI, and Sentry. GitHub is
  contacted only for anonymous update checks (see below).
- **Encarregado** (DPO): [OWNER: designate — name plus the privacidade@ contact.]

## The privacy boundary (the marquee control)

PickForge is a local-first desktop developer tool. Its defining property is that
almost everything stays on the user's machine and is never transmitted. The
following never leave the device as part of normal use:

Source code, chat transcripts, voice audio and its on-device transcription
(whisper.cpp), screenshots, file paths, device serials, hostnames, tailnet IPs,
the raw Operator command text the user types, and any bring-your-own (BYO) API
keys or CLI configs used for local AI routing.

Everything in the inventory below is the deliberate, narrow set of exceptions —
each one is either account-gated, Pro-gated and opt-in, or a scrubbed
diagnostic/technical signal.

## Data inventory

| Data element | Where stored | Processor | Legal basis (Art. 7) | Retention | Leaves the device? |
| --- | --- | --- | --- | --- | --- |
| Source code, transcripts, voice audio + local transcription, screenshots, file paths, device serials, hostnames, tailnet IPs, raw Operator command text, BYO keys/CLI configs | User's machine only | None | N/A (not processed by the controller) | Fully under the user's control locally | **No — never** |
| Email + OAuth identity (Google sign-in) | Supabase | Supabase (auth) | Contract execution (Art. 7, V) | Until account deletion | Yes (only when the user creates an account) |
| Profile (display name, avatar) | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only) |
| Entitlements (whether Pro is active) | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only) |
| Credit ledger (prepaid purchases and usage — amounts, timestamps, Stripe references) | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only) |
| Synced settings — four allowlisted groups: app settings, operator config, keybindings, remote bindings | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only; secret-scrubbed before sync) |
| Per-user rate-limit counters | Supabase | Supabase | Legitimate interest (Art. 7, IX) — abuse prevention | Short-lived / rolling | Yes (account only) |
| Security and audit logs, fraud prevention signals | Supabase / server | Supabase | Legitimate interest | As needed for security | Yes (account only) |
| Stripe customer id linkage | Supabase | Supabase + Stripe | Contract execution | Until account deletion | Yes (account only) |
| Card data, payment and invoice history | Stripe only | Stripe | Contract execution | Per Stripe's legal/fiscal obligations | Yes — handled entirely by Stripe; PickForge never sees or stores card numbers |
| Hosted Operator routing payload — typed command text + redacted allowlisted context (project display name, visible chat titles, widget labels; paths/hostnames/domains/IPs/serials stripped) | Sent to OpenAI for one action; not retained in the ledger | OpenAI | Consent (Art. 7, I) — opt-in, Pro-only, per command | Not retained by PickForge; ledger keeps only action name, token counts, cost | Yes — only when the user selects the Hosted router for that command |
| Hosted voice audio stream (Pro-only; behind a feature flag / future) | Streamed to OpenAI Realtime | OpenAI | Consent — opt-in, Pro-only | Not retained by PickForge | Yes — only when the user uses hosted voice; the default voice path is local |
| Crash / error reports (opt-out) | Sentry | Sentry | Legitimate interest — stability and security | Per Sentry retention | Yes by default in release builds; user can disable in Settings → Crash reports |
| Update check | GitHub Releases | GitHub (transport only) | Legitimate interest — deliver updates | Not stored by PickForge | Yes — version metadata only; no personal data or source leaves the machine |

Notes on the two flows not in the original account/Pro scope but present in the
real build (see `docs/architecture/telemetry-and-crash-reports.md` and
`SECURITY.md`):

- **Crash reports** are opt-out, default-on in release builds only. `before_send`
  clears `server_name` and breadcrumbs; `send_default_pii` is off; PickForge
  never intentionally adds source, transcripts, prompts, screenshots, paths,
  serials, or user ids. Native minidumps can still contain fragments of process
  memory at crash time, and error messages can occasionally reference a path.
- **Update check** is an anonymous request to GitHub Releases for version
  metadata. No account or source data is attached.

## Processors and international transfer (Art. 33)

All processors operate outside Brazil. Transfer relies on each provider's
contractual safeguards / DPA. Owner to confirm the current links.

| Processor | Purpose | Safeguard / DPA (owner to confirm) |
| --- | --- | --- |
| Supabase | Account, auth, entitlements, credit ledger, settings sync, rate limits, audit | [OWNER: confirm Supabase DPA / privacy link] |
| Stripe | Payments, card handling, invoices, customer record | [OWNER: confirm Stripe DPA / privacy link] |
| OpenAI | Hosted Operator routing; hosted voice (flagged) | [OWNER: confirm OpenAI DPA / privacy link] |
| Sentry | Crash / error reporting | [OWNER: confirm Sentry DPA / privacy link] |
| GitHub | Anonymous update-check transport (version metadata only) | [OWNER: confirm GitHub privacy link] |

## Legal bases summary (Art. 7)

- **Contract execution (Art. 7, V):** account, billing, entitlements, credits,
  settings sync — everything needed to provide the paid service the user signed
  up for.
- **Legitimate interest (Art. 7, IX):** security, fraud prevention,
  rate-limiting, audit logs, crash/error reporting, update delivery.
- **Consent (Art. 7, I):** hosted Operator routing and hosted voice — both
  opt-in, Pro-only. Marketing communications only if ever offered, and only with
  separate consent.

## Controls

- **The boundary.** The local-only set above is never transmitted. This is the
  "#118 privacy boundary" and the product's headline privacy property.
- **Sync allowlist + secret scrub.** Only four setting groups sync (app
  settings, operator config, keybindings, remote bindings), each passed through a
  secret-scrubbing check so tokens and keys cannot sync.
- **Hosted-routing redaction (test-enforced).** Before any hosted Operator
  request, file paths, hostnames, domains, IPs, and serials are stripped; only
  display names, visible chat titles, and widget labels remain. Automated tests
  enforce this redaction (see `docs/architecture/operator.md`).
- **Crash-report scrubbing.** `before_send` clears server name and breadcrumbs;
  no PII is added by PickForge; opt-out in Settings.
- **Deletion.** In-app account deletion erases all PickForge-side personal data
  (profile, entitlements, synced settings, credit ledger) via database cascade,
  and deletes the Stripe customer. Any remaining credits are forfeited. Stripe
  retains its own transaction records to meet its legal/fiscal obligations.
- **Export.** In-app data export produces a portable JSON of profile,
  entitlements, credit ledger, and synced settings.

## Data-subject rights (Art. 18)

Titulares may confirm processing, access, correct, anonymize/delete, request
portability, and obtain information about processing and sharing. How to
exercise:

- **Account deletion** (in-app) — cascade erase of PickForge-side personal data
  plus Stripe customer deletion; remaining credits forfeited.
- **Data export** (in-app) — portable JSON.
- **Contact channel** — **privacidade@pickforge.dev** [OWNER: activate this
  mailbox] for any other request, and to reach the encarregado.

## Retention

- Account data: retained until the user deletes the account.
- Stripe payment records: retained by Stripe per its legal/fiscal obligations.
- Local data: entirely under the user's control on their machine; PickForge sets
  no server-side retention over it because it never receives it.

## Owner action checklist

- [ ] Publish `privacy.*` and `terms.*` to https://pickforge.dev/privacy and
  https://pickforge.dev/terms.
- [ ] Designate the encarregado (name + privacidade@pickforge.dev).
- [ ] Activate the **privacidade@pickforge.dev** mailbox.
- [ ] Confirm / link each processor's DPA (Supabase, Stripe, OpenAI, Sentry,
  GitHub).
- [ ] Set `<EFFECTIVE DATE>` across both policy languages.
- [ ] Fill every `[OWNER: ...]` placeholder (legal entity/CNPJ or CPF, address
  if required, encarregado, comarca).
- [ ] Confirm whether crash reporting and the GitHub update check should be named
  in the published policy exactly as drafted (they are real, off-device flows).
- [ ] Have a Brazilian lawyer review before publishing.
- [ ] After publishing, update the Google OAuth consent screen with the two URLs
  and link them from the app Settings and the README.
