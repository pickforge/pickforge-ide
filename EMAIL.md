# PickForge — Email Playbook

Reference doc for the brand's email setup. Kept in the project root alongside `SOCIAL.md`. Updated as we scale.

## Goals

1. **Clean separation between public inbound mail, automation, and account-recovery noise** so real user messages don't drown in "new login from Chrome" notifications.
2. **Credibility signals** — dedicated `security@` and `legal@` addresses mark the project as a serious OSS effort, not a side-project.
3. **Zero cost in MVP** — free forwarding stack covers 100% of MVP needs. Upgrade only when volume justifies it.
4. **Future-proof** for the Pro tier's transactional email needs (password resets, receipts) without rework.

## Addresses — day-one set

Five aliases live from launch day. All forward to a single personal inbox initially.

| Address | Purpose | Visible where |
|---|---|---|
| `hello@pickforge.dev` | Primary public contact. General inbound from users, press, partnerships. | Landing page, GitHub README, pub.dev publisher page. |
| `accounts@pickforge.dev` | **Registration address for every third-party service** — X, YouTube, Product Hunt, Stripe, Supabase, GitHub org owner, Cloudflare, domain registrar, Plausible/GoatCounter, Resend, anywhere that sends "new login" / "verify your email" mail. | Nowhere public. Internal use only. |
| `bot@pickforge.dev` | Automation and bot service identity. Not a human support channel. | Nowhere public. Internal use only. |
| `security@pickforge.dev` | Vulnerability reports. | `SECURITY.md`, `/.well-known/security.txt`, GitHub repo sidebar. |
| `legal@pickforge.dev` | Privacy/LGPD requests plus DMCA, copyright, and trademark inquiries. | Privacy Policy, Terms, landing page footer, LICENSE footer if desired. |

## Why separate `hello@` from `accounts@`

Third-party services generate huge volume of account-recovery noise — password resets, 2FA codes, "new login from device X", "we updated our terms", "your subscription renewed", etc. If you sign up for X with `hello@`, all of that drowns genuine user inbound.

Rule: **never use `hello@` to sign up for anything**. Any service that asks for an email gets `accounts@`. Forever.

## Addresses — add when needed

Don't create these preemptively. Add when the need appears.

| Address | Create when |
|---|---|
| `support@` | `hello@` volume makes triage painful and you want a separate queue. |
| `press@` | First journalist asks for a press contact. |
| `noreply@` | You send transactional mail (receipts, password resets, account confirmations). Required for any From header on system-sent mail. |
| `billing@` | Pro tier active, subscription invoices or disputes incoming. |
| `partnerships@` | First real inbound partnership request, not before. |
| `careers@` / `jobs@` | You're actually hiring. |
| `abuse@` | RFC standard; create if abuse becomes a real channel. |
| `postmaster@` | RFC 5321 requires it for any domain that *sends* email. Create alongside `noreply@`. |

## Hosting — MVP stack

**Cloudflare Email Routing** (free) for receiving + reply-from-personal-Gmail for MVP.

### Setup order

1. Buy `pickforge.dev` at a registrar (Cloudflare Registrar is fine, or Porkbun if cheaper).
2. Point nameservers at Cloudflare DNS (free, fast, low-latency).
3. In Cloudflare → Email → Email Routing:
   - Add destination address: your personal Gmail (confirm via email).
   - Add custom addresses: `hello@`, `accounts@`, `bot@`, `security@`, `legal@` — all routing to the personal Gmail destination.
   - Optional catch-all: forward `*@pickforge.dev` → personal Gmail so typos don't bounce.
4. Cloudflare auto-adds MX + SPF records.
5. Done. ~10 minutes of work.

### What this stack does

| Capability | Supported |
|---|---|
| Receive mail at any `*@pickforge.dev` | Yes |
| Forward to your personal inbox | Yes |
| Reply as "PickForge" in personal Gmail with a signature | Yes (manual) |
| Send *as* `hello@pickforge.dev` | No — requires SMTP setup (see below) |
| Send transactional mail (password resets, receipts) | No — requires separate provider |

For MVP, receiving is the only real need. Replies come from your personal Gmail signed as "PickForge / Elberte". Fine for volumes below ~10 messages/day.

## Hosting — upgrade paths

In order of when each one starts to matter:

### 1. Sending as `hello@pickforge.dev` — Resend

When `hello@` volume makes "replies coming from personal Gmail" look unprofessional (usually ~month 2-3 after launch):

- Sign up for **Resend** (free tier: 100/day, 3k/mo — enough for solo founder volume).
- Add SPF, DKIM, DMARC DNS records per Resend's setup guide.
- Send via Gmail's "Send mail as" (using Resend SMTP) or via Resend's API.
- Cost: $0 until you exceed the free tier.

### 2. Full mailbox UI per alias — Zoho Mail

If you want real mailboxes (inbox, folders, filters) per alias rather than one merged forwarded inbox:

- **Zoho Mail Free** — up to 5 users, 5GB each, on custom domain. No credit card.
- Set up `hello@`, `accounts@`, `bot@`, `security@`, `legal@` as separate mailboxes.
- Cost: $0.

### 3. Gold standard — Fastmail or Google Workspace

When the free tiers constrain you, or you want best-in-class admin tools:

- **Fastmail** — $5/mo per user, excellent alias support, no Google lock-in.
- **Google Workspace** — $6/mo per user, best-in-class admin, tight Gmail UX.

Only migrate when there's a real reason.

### 4. Transactional mail for Pro tier

When the Pro tier ships:

- Already using Resend? Add transactional templates there.
- Or move to **Postmark** ($1.25/1k emails) for superior deliverability on transactional-only mail.
- Create `noreply@pickforge.dev` and `postmaster@pickforge.dev` as part of this step.
- Wire into Supabase Auth (password reset, magic-link email templates).

## Security operational notes

- **`security@pickforge.dev` is a commitment**, not decoration. Check it at least weekly. Respond within 48 hours even if just to acknowledge.
- **`legal@pickforge.dev` is the public privacy/LGPD channel.** Monitor it and route data-subject or ANPD requests promptly.
- Publish a coordinated vulnerability disclosure policy in `SECURITY.md` on day one:
  - How to report (this address).
  - Expected acknowledgement time (48 hours).
  - Expected patch timeline (reasonable best-effort; no calendar promises for an indie project).
  - Public credit policy (reporter named in release notes unless they opt out).
- Add `/.well-known/security.txt` on the landing page:
  ```
  Contact: mailto:security@pickforge.dev
  Expires: 2027-04-23T00:00:00Z
  Preferred-Languages: en, pt-BR
  Canonical: https://pickforge.dev/.well-known/security.txt
  ```
  Refresh the `Expires` date every year.

## DNS records to expect

Once the hosting stack is in place, `pickforge.dev` will have these DNS records:

- `MX` — provided by Cloudflare Email Routing.
- `TXT` SPF — `v=spf1 include:_spf.mx.cloudflare.net ~all` (Cloudflare adds).
- `TXT` DMARC — `v=DMARC1; p=quarantine; rua=mailto:security@pickforge.dev` — recommended. Starts catching spoof attempts.
- `TXT` domain verification — per service (pub.dev publisher, GitHub org, Product Hunt, etc.). Accumulates over time.
- `TXT` `_dmarc` aggregate reports — optional, routes DMARC reports to a dedicated address.
- `TXT` DKIM (per sending provider) — when Resend/Postmark is added.

Keep a running list in `docs/dns-records.md` (later — not MVP priority).

## Rules to live by

- **Never use `hello@` for third-party signups.** Ever. Use `accounts@`.
- **Never use your personal Gmail for brand signups.** Keeps a clean separation if you ever sell or transfer the brand.
- **`security@` replies within 48 hours.** Even if just to acknowledge.
- **Don't create aliases preemptively.** Each alias is a forwarding rule to maintain. Create on real need.
- **Don't mix inbound and outbound providers.** Pick one for receiving (Cloudflare / Zoho / Fastmail), one for sending (Resend / Postmark / same provider). Confusion is the #1 email setup bug.
