# LGPD Data Inventory

Internal compliance artifact. This is the source of truth the public Privacy
Policy and Terms of Service derive from. If the product changes, update this
file first, then reconcile `docs/legal/privacy.*` and `docs/legal/terms.*`.

Draft — pending owner review and review by a Brazilian lawyer before anything
built on it is published. Refs: pickforge/pickforge#155.

## Roles (LGPD)

- **Titular** (data subject): the person using PickForge.
- **Controlador** (controller): the entity that decides how and why personal
  data is processed: **ELBERTE PLINIO GOIS VIEIRA FILHO DESENVOLVIMENTO DE
  SOFTWARE LTDA**, CNPJ **63.103.885/0001-74**, operating under the trade name
  **Elberte Software**.
- **Operadores** (processors): third parties that process data on the
  controller's instructions — Supabase, Stripe, OpenAI, and Sentry. GitHub is
  contacted as an OAuth identity provider when the user selects GitHub sign-in,
  and for anonymous update checks (see below). [LAWYER: confirm GitHub's role for
  each flow.]
- **Privacy contact:** **privacidade@pickforge.dev** [OWNER: activate this
  mailbox]. [OWNER/LAWYER: confirm whether the small-processing-agent exemption
  applies under [ANPD Resolution CD/ANPD No. 2/2022](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022);
  if it does not, formally appoint and publish the encarregado.]

## The privacy boundary (the marquee control)

PickForge is a local-first desktop developer tool. Its defining property is that
its own services do not receive the user's development content by default. The
following stay on the device unless the user authorizes a configured
bring-your-own (BYO) agent/provider to process them:

Source code, chat transcripts, voice audio and its on-device transcription
(whisper.cpp), screenshots, local project paths, device serials, local hostnames
and tailnet IPs. BYO API keys and CLI configs remain on the device; the selected
provider may receive prompts, Operator command text, and project/tool context
authorized through that provider's permission model, under its own terms.

Everything in the inventory below is the deliberate, narrow set of exceptions:
user-directed BYO providers, account sync, opt-in hosted features, and scrubbed
diagnostic/technical signals.

## Data inventory

| Data element | Where stored | Processor | Legal basis (Art. 7) | Retention | Leaves the device? |
| --- | --- | --- | --- | --- | --- |
| Source code, transcripts, voice audio + local transcription, screenshots, local project paths, device serials, local hostnames/tailnet IPs | User's machine unless a BYO agent/provider is authorized to process prompts or project/tool context | None by PickForge; the user's selected provider for authorized content | N/A for the local-only path [LAWYER: confirm role/basis for user-directed BYO flows] | Under the user's local control; any BYO provider retention follows that provider's terms | Not sent to PickForge-operated services by default; may leave through an authorized BYO provider |
| BYO Operator routing payload — raw command text plus the routing prompt/schema | Sent directly from the device through the user's selected CLI/provider; not stored by PickForge's backend | User-selected provider (for example Claude Code, Codex, or a local Ollama instance) | [LAWYER: confirm role and legal basis for user-directed BYO routing] | Not retained by PickForge; provider retention follows the user's provider agreement | Yes for cloud-backed BYO providers; no for a local provider such as Ollama |
| Email + OAuth identity (Google or GitHub sign-in) | Supabase; selected OAuth provider participates in sign-in | Supabase (auth) + Google or GitHub when selected | Contract execution (Art. 7, V) | PickForge account data until deletion; OAuth-provider retention follows its terms | Yes (only when the user creates an account) |
| Profile (display name, avatar) | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only) |
| Entitlements (whether Pro is active) | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only) |
| Credit ledger (prepaid purchases and usage — amounts, timestamps, Stripe references) | Supabase | Supabase | Contract execution | Until account deletion | Yes (account only) |
| Synced settings — four opt-in allowlisted groups: app settings, operator config, keybindings, and remote bindings. A remote binding contains project basename, tailnet hostname, and absolute remote project root | Supabase | Supabase | Contract execution | Until account deletion | Yes when sync is enabled; secret-scrubbed before sync |
| Per-user rate-limit counters | Supabase | Supabase | Legitimate interest (Art. 7, IX) — abuse prevention | Short-lived / rolling | Yes (account only) |
| Security and audit logs, fraud prevention signals | Supabase / server | Supabase | Legitimate interest | As needed for security | Yes (account only) |
| Stripe customer id linkage | Supabase | Supabase + Stripe | Contract execution | Until account deletion | Yes (account only) |
| Card data, payment and invoice history | Stripe only | Stripe | Contract execution | Per Stripe's legal/fiscal obligations | Yes — handled entirely by Stripe; PickForge never sees or stores card numbers |
| Hosted Operator routing payload — command text as typed + redacted allowlisted attached context (project display name, visible chat titles, widget labels; identifiers stripped from attached context, not from user-authored command text) | Passes transiently through PickForge's Supabase Edge Function to OpenAI for one action | Supabase + OpenAI | Consent (Art. 7, I) — opt-in, Pro-only, per command | Not stored in the PickForge ledger; ledger keeps only action name, token counts, and cost. [LAWYER: confirm Supabase/OpenAI operational retention] | Yes — only when the user selects the Hosted router for that command |
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

## Providers and international transfer review (Art. 33)

Several service flows may involve processing outside Brazil. Counsel must verify
which flows are international transfers under the LGPD and identify the valid
Art. 33 mechanism for each one under [ANPD Resolution CD/ANPD No. 19/2024](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-19-de-23-de-agosto-de-2024).
The vendor documents below are inputs to that review, not conclusions that a
valid transfer mechanism is already in place.

| Provider / recipient | Purpose | Vendor document for lawyer review |
| --- | --- | --- |
| Supabase | Account, auth, entitlements, credit ledger, settings sync, rate limits, audit, and transient hosted-router Edge Function processing | [Data Processing Addendum](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260601.pdf) |
| Stripe | Payments, card handling, invoices, customer record | [Data Processing Agreement](https://stripe.com/legal/dpa) |
| OpenAI | Hosted Operator routing; hosted voice (flagged) | [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) |
| Sentry | Crash / error reporting | [Data Processing Addendum](https://sentry.io/legal/dpa/) |
| GitHub | OAuth identity provider when selected; anonymous update-check transport | [GitHub General Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |

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

- **The boundary.** PickForge-operated services do not receive development
  content by default. User-directed BYO flows and every PickForge-operated
  exception are disclosed separately. This is the "#118 privacy boundary" and
  the product's headline privacy property.
- **Sync allowlist + secret scrub.** Only four setting groups sync (app
  settings, operator config, keybindings, remote bindings), each passed through a
  secret-scrubbing check so tokens and keys cannot sync.
- **Hosted-routing redaction (test-enforced).** Attached local context is limited
  to display names, visible chat titles, and widget labels, with paths,
  hostnames, domains, IPs, and serials stripped. User-authored command text is
  sent verbatim and is not covered by attached-context redaction. Automated
  tests enforce this boundary (see `docs/architecture/operator.md`).
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
  mailbox] for any other privacy or data-subject request.

## Retention

- Account data: retained until the user deletes the account.
- Stripe payment records: retained by Stripe per its legal/fiscal obligations.
- Local data: entirely under the user's control on their machine; PickForge sets
  no server-side retention over it because it never receives it.

## Owner action checklist

- [ ] Publish `privacy.*` and `terms.*` to https://pickforge.dev/privacy and
  https://pickforge.dev/terms.
- [ ] Have counsel confirm whether the small-processing-agent exemption applies;
  otherwise designate and publish the encarregado.
- [ ] Activate the **privacidade@pickforge.dev** mailbox.
- [ ] Have counsel classify each cross-border flow and confirm its valid Art. 33
  mechanism; use the linked vendor documents as review inputs.
- [ ] Set `<EFFECTIVE DATE>` across both policy languages.
- [ ] Fill the remaining owner/lawyer placeholders (mailboxes, refund stance,
  liability cap, comarca, and encarregado status).
- [ ] Confirm whether crash reporting and the GitHub update check should be named
  in the published policy exactly as drafted (they are real, off-device flows).
- [ ] Have a Brazilian lawyer review before publishing.
- [ ] After publishing, update the Google OAuth consent screen with the two URLs
  and link them from the app Settings and the README.
