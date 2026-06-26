# PickForge — Social Media Playbook

Reference doc for the marketing side of PickForge. Kept in the project root so it's not forgotten. Updated as we learn what works.

## Goals

1. **Drive OSS adoption** — stars on GitHub, installs, Discord/issue contributors.
2. **Make the widget-picker demo inescapable** — the 30-second GIF is the product pitch. Every channel surfaces it.
3. **Build founder credibility** for a future PickForge Pro launch without committing to "build in public" posting overhead right now.
4. **Reserve namespace** across every channel that matters so we can expand later without re-branding.

## Handle strategy

Use the exact handle **`pickforge`** everywhere it's available. A fragmented handle landscape (`@pickforge` on X but `@pickforgeapp` on YouTube) dilutes brand recognition.

### Availability check — do this FIRST

Before investing further in the name or buying the domain, verify `pickforge` is free across all Tier 1-3 channels:

- **namechk.com** (search `pickforge` — one-shot cross-platform scan)
- Or **instantusername.com**

If `pickforge` is **taken on X specifically**, stop and decide: live with a suffix (`@pickforgedev` / `@pickforge_dev`), pick a different product name, or DM the current owner. Don't proceed to handle claims with a fragmented setup.

## Channel tiers

### Tier 1 — essential, high ROI

| Channel | Handle | Action | When |
|---|---|---|---|
| X / Twitter | `@pickforge` | Claim handle. Bio: "Coming soon · github.com/pickforge". | Day one |
| GitHub org | `pickforge` | Create the org **before** any public repo push. Verify `pickforge.dev` domain for the checkmark. | Day one |
| Product Hunt | `pickforge` | Reserve the slug. Don't launch yet. | Launch day |

### Tier 2 — high value, specific purpose

| Channel | Handle | Action | When |
|---|---|---|---|
| YouTube | `@pickforge` | Claim handle now. First video around launch (screen-recorded demo). | Claim now, post later |
| Pub.dev | verified publisher `pickforge.dev` | Verify domain on pub.dev. Publish extracted utility packages (e.g., `pickforge_vm_service_tools`) to build Flutter-ecosystem reputation. | Month 1-2 post-launch |

### Tier 3 — community presence, not a marketing channel

Show up as a human (personal account), not a brand account:

| Channel | How |
|---|---|
| r/FlutterDev, r/reactnative, r/androiddev | Post the demo from your personal account when it's genuinely cool, matched to each community's framework. No corporate tone. |
| Flutter / React Native / Android dev Discords + Slacks | Same — personal, helpful, occasional mention. |
| Hacker News | Launch day submission. Don't astroturf; don't pre-announce repeatedly. |

### Tier 4 — squat the handle, don't post

Reserve in 5 minutes each to prevent impersonation:

- **BlueSky:** `pickforge.dev` (via DNS verification) or `pickforge.bsky.social`
- **Mastodon:** `@pickforge` on a major server (e.g., `mastodon.social`)
- **Reddit username:** `pickforge` (just to reserve)

No posting plan for these. Just squat and forget.

### Tier 5 — skip for MVP

| Channel | Why skip |
|---|---|
| Instagram | Wrong audience. Dev-tool buyers don't convert from Instagram. |
| TikTok | Wrong audience. Maybe one experimental demo clip post-launch if you feel like it. Not priority. |
| Facebook | No. |
| **Brand** LinkedIn page | Skip for MVP. See personal LinkedIn note below. |

## LinkedIn — personal post at launch: YES, do it

Distinct from the "no LinkedIn brand page" call:

- **One personal post at launch** from your own LinkedIn account has meaningful upside and near-zero downside.
- LinkedIn gives high organic reach to single-shot personal posts (unlike brand pages, which are rate-limited unless you pay).
- Your existing network — Flutter colleagues, past coworkers, agency contacts — is exactly the credibility layer you want for a future enterprise/Pro conversation.
- Every Linear / Raycast / Cursor founder cross-posts their launch to LinkedIn. It's normalized and expected.
- Brazilian Flutter community is active on LinkedIn (more than US/UK counterparts).

**What the post looks like:**

- One personal "I built this" paragraph (what it is, who it's for, why it matters).
- The 30-second demo GIF or YouTube embed.
- Link to `pickforge.dev` and GitHub repo.
- No jargon for non-devs in your network — they don't need to understand Flutter to appreciate "I built a tool that lets an AI edit a specific part of my mobile app by just clicking it".
- Reply to every comment for 24 hours after posting. LinkedIn's algorithm rewards sustained engagement within the first day.

**What NOT to do:**

- Don't run a PickForge LinkedIn *brand page*. One personal post is the commitment; a brand page is a channel you have to feed.
- Don't do "build in public" LinkedIn updates weekly. Dilutes the launch post's impact.
- Don't write a manifesto. Short, confident, demo-led.

## Practical launch-day sequence

Order of operations from handle registration to launch:

1. **Now (10 min):** Run namechk scan on `pickforge`. Confirm availability on X, YouTube, GitHub, Reddit, BlueSky, Mastodon.
2. **Now (5 min):** Buy `pickforge.dev`.
3. **Today (15 min):** Create GitHub org `pickforge`. Add domain verification TXT record.
4. **Today (10 min):** Claim `@pickforge` on X, YouTube, BlueSky, Mastodon, Reddit. Bio placeholder: "Coming soon · pickforge.dev".
5. **Today (5 min):** Reserve `pickforge` slug on Product Hunt (don't submit launch yet).
6. **Pre-launch (weeks):** Go dark on brand accounts until there's a demo GIF that makes people go *"wait, what is that?"*. Don't post filler content.
7. **Launch day:**
   - Morning: Push to Product Hunt at 00:01 Pacific (PH reset time).
   - Morning: Submit to HN ("Show HN: PickForge – click an element in your running app, Claude edits it").
   - Morning: Personal LinkedIn post with demo GIF.
   - Morning: X thread from `@pickforge`, founder co-posts from personal account.
   - Afternoon: Post to r/FlutterDev (and r/reactnative / r/androiddev), plus the Flutter / React Native / Android community Discords and Slacks.
   - All day: reply to every comment everywhere.

## Posting cadence (post-launch)

Minimum viable to not disappear:

- **X `@pickforge`**: 1-3 posts per week when there's something real (release, demo, community contribution, bug-squash). No filler.
- **YouTube**: one video per major release. Screencast demos outperform talking-head videos for this kind of tool.
- **GitHub**: release notes on every tagged release, even patch releases. This is how power users track you.
- **Personal LinkedIn**: when a real milestone happens (1k stars, Pro launch, a notable user). Not monthly. Quality over cadence.

## Content ideas bank

For when you're stuck on what to post:

- 15-second "pick a widget, Claude rewrites it" GIFs with different starting widgets.
- Before/after screenshots of a widget edited by PickForge.
- Threads explaining one PickForge feature at a time (skill library, TerminalProfile detection, .pickforge/ folder rationale).
- Community spotlights — someone else's PickForge PR, a blog post about using it.
- Honest "what didn't work" posts — which are gold on X/HN for credibility.
- Comparison posts ("why I used Flutter instead of Tauri for PickForge") — discussion-generating.

## Dashboard / measurement

Nothing elaborate. Once a week, eyeball:

- GitHub stars + issues + PRs
- X followers + per-post impressions on the last 3 posts
- `pickforge.dev` traffic (Plausible or GoatCounter — lightweight, privacy-friendly)
- New Discord members (if we start a Discord; defer until ~100 stars)

Skip Google Analytics. Too heavy for a dev tool and privacy-hostile to your audience.

## Things to explicitly NOT do

- **No AI-spam posts** — dev audiences detect and punish ChatGPT-flavored content instantly.
- **No engagement bait** — "Guess what I built 👀" without substance burns credibility.
- **No cross-platform repost-everywhere automation** — each channel needs native-format content.
- **No pre-launch hype cycle longer than 2 weeks.** Hype fatigue kills launches. Go dark, then strike.
- **No paying for followers or fake engagement.** Ever.

## Review date

Revisit this doc after the MVP launch week to see what actually worked. Prune what didn't.
