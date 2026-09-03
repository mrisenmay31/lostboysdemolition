# Adoption sprint checklist (Matt-owned) — opened 2026-09-02, Session 17

> The build side of adoption is the estimate builder redesign (`2026-09-02-estimate-builder-redesign.md`, builds
> Session 18) followed by the 8b status action (`2026-09-02-v2-task8b-status-action-staged.md`). These items are the
> no-code half. Check them off in this file; BUILD_LOG records the dates.

## Before / during the redesign build
- [ ] **Slack bot invites** to Crew 1–4 channels (BL-8, open since 2026-08-20). Until done, every real scheduled
      job's crew-Slack leg dead-letters loudly.
- [ ] **Confirm the palette anchor** on the deployed preview: the prototype ink/orange tokens are placeholders;
      swap values in `globals.css` if Lost Boys wants brand colors (navy/charcoal + white per lostboysdemolition.com).
- [ ] **Logo asset** for the `BrandMark` slot (optional; the striped placeholder ships otherwise).

## Cutover (after the redesign is live)
- [ ] **Matt's phone smoke on one REAL estimate (≥1431)** through Job → Client → Financial → Review, incl. a draft
      save/resume and a line-price edit; Save and send → verify the GHL opportunity fields + draft estimate document
      show the per-line prices exactly as typed. (This is the redesign's gate 5.)
- [ ] **15-minute phone walkthrough with Dane and Jackson** on the redesigned builder.
- [ ] **Jackson's timed side-by-side**: one real bid in Fillout and in the app; note every friction point. The
      friction list is the only UI work queued before cutover.
- [ ] **Estimating cutover date + mandate**: from `<date>`, every estimate goes in the app; Fillout is read-only.
      In-flight Fillout estimates that get scheduled after cutover are re-entered in the app (quick: hours, dumps,
      costs, margin; scope lines optional).
- [ ] **Weekly actuals ritual** (ruling 2: anyone enters): Dane/Jackson enter as they go; CTA keys Gusto hours and
      BILL spend weekly on each job's costs screen; invoice amounts on the revenue screen.

## Measure
- [ ] Session-open metric: Airtable `Estimates` last Estimate ID (baseline **360** on 2026-09-02) vs app estimates
      created (first real ≥ **1431**). The sprint is working when the Airtable number stops moving.
- [ ] **30-day milestone**: N real jobs through schedule → started → completed → costs/revenue → dashboard. Then pick
      the first automation: BILL (Task 14) vs time import (Task 13), by which manual step hurt most.

## Deferred, deliberately
- Dane's owner invite (runbook §4) — owner auth is dormant; revisit when foremen need restricted access.
- Foreman area (8b-as-specced), Slack ops channel (Task 12), Phases 4–6 of v2 (frozen backlog).
