# Pickforge Pro Backend Direction

Pickforge MVP remains local-first. Pickforge Pro should use Supabase only for
features that need identity, entitlement, collaboration, or cloud sync.

## Platform Choice

Supabase is the committed backend direction because it provides hosted Postgres,
Auth with social OAuth providers such as Google and GitHub, Row Level Security,
Realtime subscriptions, Storage, and Edge Functions. Stripe integration should
live behind server-side functions or database integrations; no Stripe secret
belongs in the desktop app.

## Initial Scope

- Auth: Google and GitHub sign-in.
- Entitlements: free/pro/team access checks.
- Team membership: organizations, roles, invites, and project access.
- Premium skill packs: signed download metadata and versioned manifests.
- Cloud sync: explicit opt-in sync for selected Pickforge metadata.
- Multi-agent orchestration: run/session metadata first, not remote execution.
- Billing: Stripe customer/subscription state mirrored into Postgres through a
  webhook or Edge Function.

## Data Boundaries

Do not sync source code, prompts, transcripts, screenshots, `.pickforge/`
context files, local project paths, device serials, or raw support bundles by
default. Any future sync of context content requires a user-visible preview,
redaction, and project-level opt-in.

## Suggested Tables

- `profiles`: user profile and billing-visible identity fields.
- `organizations`: team/workspace records.
- `memberships`: user-to-organization role bindings.
- `entitlements`: normalized pro/team feature flags.
- `skill_packs`: premium pack metadata, version, checksum, and visibility.
- `project_links`: user-approved local project aliases without absolute paths.
- `sync_records`: opt-in metadata sync records with redaction version.
- `agent_runs`: optional orchestration status metadata.
- `billing_customers`: Stripe customer/subscription mirror.

Every table containing user or team data must have Row Level Security enabled.
Policies should authorize through `auth.uid()` and organization membership,
with service-role access limited to server-side billing/webhook functions.

## Client Model

- The desktop app stores only the anon key and public project URL.
- Auth should open the browser and return through a desktop-safe redirect or
  manual code flow.
- The app should cache entitlement state locally so core local workflows keep
  working offline.
- Cloud features must degrade to local-only behavior when unauthenticated.

## Backend Services

- Edge Function: Stripe webhook receiver.
- Edge Function: signed premium skill-pack URL issuer.
- Edge Function: account deletion/export workflow if required by policy.
- Realtime: team membership and shared metadata updates after RLS policies are
  proven with tests.

## Release Gates

- Threat model for source/prompt leakage.
- RLS policy tests for every user/team table.
- Local sign-out and account deletion behavior.
- Billing webhook replay/idempotency tests.
- Offline behavior for expired or missing entitlement cache.
- Privacy copy in Settings before any cloud sync toggle ships.
