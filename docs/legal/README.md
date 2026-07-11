# Legal pages

Drafts of PickForge's user-facing legal pages, in English and Brazilian
Portuguese:

- `privacy.en.md` / `privacy.pt-BR.md` — Privacy Policy.
- `terms.en.md` / `terms.pt-BR.md` — Terms of Service.

They derive from the internal LGPD data inventory in
`../compliance/lgpd-data-inventory.md` — the source of truth. Change the
inventory first, then reconcile these pages.

**Status: drafts.** Not published, not legal advice. They need the owner's review
and a Brazilian lawyer's review before going live. Refs: pickforge/pickforge#155
(LGPD), #156 (legal pages — these block publishing the Google OAuth consent
screen).

Once approved, they publish to:

- https://pickforge.dev/privacy
- https://pickforge.dev/terms

## Owner action checklist

- [ ] Publish `privacy.*` and `terms.*` to https://pickforge.dev/privacy and
  https://pickforge.dev/terms.
- [ ] Have counsel confirm whether the small-processing-agent exemption applies;
  otherwise designate and publish the encarregado (DPO).
- [ ] Activate the **privacidade@pickforge.dev** mailbox (and confirm
  **contato@pickforge.dev** for the Terms).
- [ ] Have counsel classify each cross-border flow and confirm its valid LGPD
  Art. 33 mechanism; use the linked vendor documents as review inputs.
- [ ] Set `<EFFECTIVE DATE>` in all four policy files.
- [ ] Fill the remaining owner/lawyer placeholders — mailboxes, refund stance,
  liability cap, comarca, and encarregado status.
- [ ] Have a Brazilian lawyer review before publishing.
- [ ] Then update the Google OAuth consent screen with the two URLs, and link them
  from the app Settings and the README.
