---
version: 1
slug: "web-src"
primary_target: "web/src"
related_targets: ["web/index.html"]
---

# Web app: account and access screens

Scope: Setup, Sign in, Sign up (invite), Connector consent, Admin (invites and users). Visitor mode: Operate. The same world carries the release 2 dashboard.

Audience and job: the owner and a few invited people, on phone and laptop. Get in, decide whether an AI connector may act for them, and (owner) hand out access. Constraints: English copy, WCAG 2.2 AA, docs/design-framework.md rules, PRODUCT.md principles, every number in tabular figures.

## Direction contract

THESIS: Every screen is a printer's exposure record: what is being granted or measured sits as a ruled entry on a record card over one fixed neutral ramp. It refuses the soft centered card with a logo pair and a blue Allow button.

OWN-WORLD: Neutral ground (chroma 0, never cream), ink at the ramp's dark end, an eleven-step zone ramp as the only neutrals. One dichroic magenta marks only the decision in focus: active nav, the key row, the primary action's consequence segment. Hairline ruled tables, condensed tracked caps for titles and legends, tabular figures. Hatching means conflict or held back only, never balances. Square buttons carry a value segment.

STORY: The visitor reads who is asking, for which account, and where access returns, then decides with nothing hidden. The owner reads invites as an exposure log: issued, used, held back, expired.

FIRST VIEWPORT: Consent. Top bar: wordmark, zone ramp strip, signed-in email. Main: a record card titled ACCESS REQUEST in condensed caps, a ruled table (Application, Account, Returns to, Can read, Can record) with Returns to as the key row; an unknown host turns that row magenta-hatched with a plain warning beneath. Action row: Deny beside Allow access, whose value segment names the return host. A second sheet sits offset behind the card. Phone: one column, actions pinned under the table.

FORM: Exposure Record (catalog challenger, adopted by the user from the declined row), fused with Moneytor's access screens. seed:74d9d18746610c49

SIGNATURE: the primary button's value segment states the consequence (return host, invite lifetime, account) and fills magenta while the action applies.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Dashboard composition (release 2) is decided when that surface starts.
