# Privacy Policy

**Effective date:** `<EFFECTIVE DATE>`

PickForge is a local-first desktop developer tool. This policy explains, plainly,
what stays on your machine, the narrow set of things that leave it, who processes
them, and the rights you have under Brazil's LGPD (Lei nº 13.709/2018).

Controller: **ELBERTE PLINIO GOIS VIEIRA FILHO DESENVOLVIMENTO DE SOFTWARE
LTDA**, CNPJ **63.103.885/0001-74**, operating under the trade name **Elberte
Software**. Privacy/LGPD contact: **legal@pickforge.dev**.

## The short version

- PickForge does not upload your code, chats, voice, screenshots, or unsynced
  local settings to its own services. A BYO agent/provider may receive prompts
  and project/tool context you authorize through that provider's permission
  model, under its own terms.
- If you create an account, we hold the minimum needed to run it and, if you buy
  Pro, your credits. Release builds can also send scrubbed crash reports unless
  you disable them in Settings.
- Hosted routing sends the command you provide plus a small, redacted attached
  context — only when you opt in, per action.
- You can export or delete your data from inside the app at any time.

## What PickForge keeps local

By design, PickForge does not transmit the following to PickForge-operated
services as part of its core local workflow:

- Source code and file contents.
- Chat transcripts and agent run history.
- Voice audio and its transcription — dictation is transcribed on-device by
  whisper.cpp.
- Screenshots and captured device screens.
- Local project paths, device serials, local hostnames, and tailnet IP addresses.
- Any bring-your-own (BYO) API keys and CLI configuration you use for local AI
  routing.

If you use a BYO agent or router, that provider can receive prompts, Operator
command text, and project/tool context you authorize through its permission
model, under your account and that provider's terms. PickForge does not receive
or retain that BYO payload on its backend. The account sync, hosted,
crash-report, and update-check flows below are the other narrow exceptions to
the local boundary.

## What we collect when you sign in

You can use PickForge locally without an account. When you create one, we
process — through our processor Supabase:

- **Email and OAuth identity** from Google or GitHub sign-in, depending on the
  provider you select.
- **Profile**: display name and avatar.
- **Entitlements**: whether Pro is active for you.
- **Credit ledger**: your prepaid credit purchases and usage — amounts,
  timestamps, and Stripe references.
- **Synced settings**: exactly four allowlisted groups — app settings, operator
  config, keybindings, and remote bindings. A remote binding includes the
  project basename, tailnet hostname, and absolute remote project root. Sync is
  opt-in, and each group is run through a secret-scrubbing check before syncing,
  so tokens and keys cannot leave with it.
- **Rate-limit counters** and **security/audit signals** to keep the service
  safe.

## BYO routing you choose

When Operator cannot use its deterministic local parser and you select a BYO
router, it sends the command text and routing prompt/schema through your chosen
CLI/provider. A local provider such as Ollama can keep that request on-device; a
cloud-backed provider processes it under your account and its own terms.
PickForge does not receive or store the BYO routing payload on its backend.

## Pro features that send data (opt-in)

These are off by default, available on Pro, and only ever run when you choose
them:

- **Hosted Operator routing.** When you deliberately select the "Hosted" router
  for a command, the request passes through PickForge's Supabase Edge Function
  to OpenAI to turn your natural-language command into one app action. The
  command itself is sent as typed. Attached context is limited to the project's
  display name, visible chat titles, and widget labels; file paths, hostnames,
  domains, IP addresses, and serials are stripped from that attached context by
  test-enforced redaction. The request body is not stored in the PickForge
  ledger; the ledger keeps only the action name, token counts, and cost.
  [OWNER/LAWYER: confirm Supabase/OpenAI operational retention.] The default
  routing path is deterministic and local when it can understand the command.
- **Hosted voice** (currently behind a feature flag / future). When you use
  hosted voice, audio is streamed to OpenAI's Realtime API for that session. The
  default voice path stays on-device — see "What PickForge keeps local."

## Billing

Payments are handled by Stripe. **Card data is handled entirely by Stripe;
PickForge never sees or stores your card numbers.** Stripe holds the customer
record and your payment and invoice history. On our side we store only a Stripe
customer id linkage and the credit ledger described above.

## Crash reports and update checks

- **Crash and error reports.** Release builds send scrubbed crash/error reports
  by default, through Sentry, to help us fix stability and security issues. Server
  name and breadcrumbs are cleared before reports leave the process, and we do
  not intentionally add source, transcripts, prompts, screenshots, paths,
  serials, or user ids. Native crash dumps can still contain fragments of process
  memory from the moment of the crash, and an error message can occasionally
  reference a path. You can turn this off in **Settings → Crash reports**.
- **Update checks.** On startup PickForge asks GitHub Releases whether a newer
  version exists. This carries version metadata only — no account data and no
  source leaves your machine.

## Who processes your data, and where

Some service flows may involve processing outside Brazil. [OWNER/LAWYER: before
publication, verify which flows are international transfers and state the valid
LGPD Art. 33 mechanism for each one.] The vendor documents below are listed for
transparency and legal review; listing them does not by itself establish a valid
transfer mechanism.

| Provider / recipient | What they process | Vendor document |
| --- | --- | --- |
| Supabase | Account, auth, entitlements, credits, synced settings, rate limits, audit, and transient hosted-router Edge Function processing | [Data Processing Addendum](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260601.pdf) |
| Stripe | Payments, cards, invoices, customer record | [Data Processing Agreement](https://stripe.com/legal/dpa) |
| OpenAI | Hosted Operator routing; hosted voice (flagged) | [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) |
| Sentry | Crash / error reports | [Data Processing Addendum](https://sentry.io/legal/dpa/) |
| GitHub | OAuth identity provider when selected; anonymous update-check transport | [GitHub General Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |

## Legal bases (Art. 7)

- **Contract execution.** Your account, billing, entitlements, credits, and
  settings sync — the data needed to provide the service you signed up for.
- **Legitimate interest.** Security, fraud prevention, rate-limiting, audit logs,
  crash/error reporting, and delivering updates.
- **Consent.** Hosted Operator routing and hosted voice are opt-in Pro features
  you turn on. If we ever offer marketing communications, those would require
  separate consent.

## Your rights (Art. 18)

Under the LGPD you can confirm whether we process your data, access it, correct
it, request anonymization or deletion, request portability, and ask about how
your data is shared. You can exercise these directly:

- **Delete your account** from inside the app. This erases all PickForge-side
  personal data — profile, entitlements, synced settings, and credit ledger — by
  database cascade, and deletes your Stripe customer record. Any remaining
  credits are forfeited. Note that Stripe, as payment processor, retains its own
  transaction records to meet its legal and fiscal obligations.
- **Export your data** from inside the app — a portable JSON file of your
  profile, entitlements, credit ledger, and synced settings.
- **Contact us** at **legal@pickforge.dev** for any other request. This is
  our privacy contact. [OWNER/LAWYER: confirm whether a formal Data Protection
  Officer (encarregado) appointment is required or the small-processing-agent
  exemption applies.]

## Retention

- Account data is kept until you delete your account.
- Stripe retains your payment records for as long as its own legal and fiscal
  obligations require.
- Local data stays on your machine under your control; we set no retention over
  it because we never receive it.

## Children

PickForge is a professional developer tool and is not directed at children.

## Changes to this policy

If we make material changes, we will update this page and its effective date, and
where appropriate notify you in the app. The current version always lives at
https://pickforge.dev/privacy.

## Contact

**legal@pickforge.dev** — Controller: **ELBERTE PLINIO GOIS VIEIRA FILHO
DESENVOLVIMENTO DE SOFTWARE LTDA**, CNPJ **63.103.885/0001-74**.
Encarregado (DPO): [OWNER/LAWYER: confirm appointment or exemption].
