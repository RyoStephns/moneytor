---
version: 1
slug: "web-src-pages-dashboard-tsx"
primary_target: "web/src/pages/dashboard.tsx"
related_targets: []
---

# Web app: dashboard (release 2)

Scope: the Dashboard at `/`, read-only. Visitor mode: Operate. Inherits the Exposure Record world from DESIGN.md and the web-src brief; no new tokens.

Audience and job: the owner and invited people. Phone: "am I up or down this pay period, and where did it go" in one glance. Laptop: a calmer review at payday. Constraints: every base figure comes unchanged from the same repository calls as the MCP tools (BR-018); derived figures (pace reference, per-category average for the elapsed days, deviation %) are labelled as derived in the UI. English copy, WCAG 2.2 AA, tabular figures, IDR without decimals unless the value has them.

Decided with the owner (2026-10-22): default period is the active pay period (fallbacks: previous pay periods, this calendar month, custom range; no pay periods means this calendar month); average per month always spans all history; optional account filter (total balance stays all accounts); net for the period is the lead figure; connect steps and account details move to `/account`.

## Direction contract

THESIS: The period is one exposure record held beside its working sheets: the record states where you stand, the sheets show how fast and where it went. It refuses the row of same-sized KPI tiles over a donut chart.

OWN-WORLD: The incumbent zone ramp, one magenta, square corners, condensed legend caps, tabular figures. Magenta marks only the decision in focus: the net key row, today on the pace line, and the single category furthest over its average. Bars are ink (money in) and hollow ink-framed (money out); average is a 2px ink tick. Hatching stays reserved for trouble.

STORY: The visitor reads net first, then income and expense against their average month, sees whether spending runs ahead of their usual pace, then which categories took the salary and which ran over; accounts and month-by-month history close the page.

FIRST VIEWPORT: Laptop (two columns): left 400px pinned column with the page title, Period and Account selects, and the THIS PERIOD record card (Net key row at display size, Income, Expense, Balance now, each with its average note). Right column: SPENDING PACE sheet (cumulative expense step line, dashed average reference, magenta today rule with its reading), then WHERE IT WENT step-down sheet (Income full bar, each expense category stepping it down with an average tick and a deviation figure, Net left at the end). Phone: one column in the same order, record first.

FORM: Combined panes, the user's steer fusing the first hand's three structures (deviation, pace, step-down); picked from the re-rolled hand, position 2. seed:384683246b565c5c

SIGNATURE: the step-down: each category is a hollow bar that eats into the salary, its average tick riding on the same scale, so overspend reads as distance between bar edge and tick.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- None at start of build.
