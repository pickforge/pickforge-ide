# Plan 003 - Suite Monetization

Status: source of truth for the current marketing/planning phase. No billing,
accounts, license checks, or hosted sync are implemented here.

Pickforge has one planned paid layer: Forge Pass. The free baseline stays useful
for every app, and official signed builds plus auto-updates stay available to
everyone.

## Hard Constraint

The products drive the user's own Claude, OpenAI, Codex, OpenCode, and similar
accounts. Never sell or imply bundled AI access. BYO agent auth stays visible in
the free tier. Pricing copy sells Pickforge workflow value, not model access.

## Free Baseline

- MIT source code where the app is already MIT.
- Official signed builds and auto-updates.
- Core local workflows, local history, settings, and artifacts.
- Bring-your-own agent, LLM, and provider credentials.
- PickArena public benchmarks, methodology, leaderboards, and reproducible
  reports.

## Forge Pass Candidates

- Advanced orchestration and dashboards.
- Team workflows: roles, invites, shared metadata, run libraries, and quotas.
- Premium skill packs, cleanup profiles, lab recipes, and provider connectors.
- Priority support.
- Hosted sync later, only after the privacy model is proven.

## App Strategy

### PickForge

Free: widget picking, forge-to-agent context, core chat, local history, official
builds, and BYO agent credentials.

Forge Pass: v3 orchestration, multi-lane views, thread ledger, dashboards,
teams, premium skill packs, and priority support.

### PickLab

Free: CLI, MCP tools, local sessions, artifacts, and reproducible runs.

Forge Pass: premium lab recipes, team run libraries, shared artifact dashboards,
CI/reporting workflows, and priority support.

### PickScribe

Free: local transcription, local-only mode, basic cleanup with the user's own
provider, history, tray controls, and official builds.

Forge Pass: premium cleanup profiles, custom vocabulary/profile packs,
translation workflows, team-shared dictation presets, and priority support.

### PickGauge

Free: local Codex and Claude gauges, confidence labels, basic history, service
settings, and official builds.

Forge Pass: advanced forecasting, budget alerts, multi-provider dashboards,
team quota views, premium provider connectors, and priority support.

### PickArena

No Forge Pass gating. PickArena exists as public proof: leaderboards,
methodology, task definitions, and reproducible reports stay unpaywalled.

Optional future revenue can exist only as clearly labeled sponsored evaluations
with public methodology.

## Not Implementing Yet

- Stripe, Supabase, accounts, pricing tables, or checkout.
- License-key checks or entitlement gates.
- Hosted sync, team workspaces, or account-backed settings.
- Any claim that paid features are already available.

## Before Billing

- Pick the Pro license text: FSL vs BUSL.
- Define the first paid boundary, likely PickForge v3 orchestration.
- Design local license-key verification and offline behavior.
- Write privacy copy for account and sync features.
- Review pricing-page copy against the hard constraint above.
