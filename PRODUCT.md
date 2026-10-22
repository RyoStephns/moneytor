# Product

## Register

product

## Users

The owner and a few people they invite (family, friends). They track personal money: income, spending, which pocket the money sits in, and who still owes them. Use is split evenly between phone and laptop: a quick check on the phone ("how much is left, where did it go") and a calmer review on a laptop around payday or month end.

Most day-to-day recording happens through Claude (the MCP connector). The web app is where people sign in, approve that connector, and look at the picture as a whole. Everyone sees only their own data.

## Product Purpose

Moneytor is a personal finance tracker reachable from two places that share one account: an MCP connector inside AI assistants, and a web app. The web app's job is to make the numbers trustworthy and easy to read: the same totals the assistant reports, laid out so a person understands their month at a glance.

Success: a person opens the dashboard, understands where they stand within seconds, and never wonders whether the numbers are right. Signing in, setting up an instance, and approving a connector feel safe and obvious, never like a puzzle.

## Brand Personality

Calm, precise, trustworthy.

A serious tool that isn't cold. Numbers are clear and unadorned; nothing competes with them. Copy is plain and short, in English, and says what happened and what to do next. The interface should make people feel their data is in good hands, especially on screens that grant access (setup, sign in, connector approval).

## Anti-references

- Corporate banking apps: stiff, dense, navy and gold, bureaucratic.
- Over-cute budgeting apps: mascots, emoji everywhere, gamification, candy colors.
- Generic SaaS dashboard templates: rows of same-sized icon cards, gradients, big number with a tiny label.
- Trading and crypto apps: neon dark mode, busy charts, a casino feel.

## Design Principles

1. **The numbers are the interface.** Hierarchy, type, and space exist to make figures legible and comparable. Decoration that doesn't help read a number goes.
2. **Trust is earned on the access screens.** Setup, sign in, sign up, and connector approval say exactly who is asking for what. Anything unusual (an unknown app, an unfamiliar redirect) is called out plainly, never hidden.
3. **Comprehensive without clutter.** Show the whole picture, but in a clear order: what matters first, detail on demand. Efficient means fewer steps and less to scan, not more crammed in.
4. **Same truth everywhere.** The web app never shows a number the assistant would report differently. Consistency is a feature.
5. **Equal on phone and laptop.** Every screen works fully at phone width and uses the extra room on a laptop; neither is the afterthought.

## Accessibility & Inclusion

WCAG 2.2 AA as the baseline (assumed default, not yet confirmed by the owner): body text contrast ≥ 4.5:1, visible focus, full keyboard use, labelled form fields with inline errors. Respect `prefers-reduced-motion`. Never rely on color alone for meaning, such as money in versus money out or a warning state.
