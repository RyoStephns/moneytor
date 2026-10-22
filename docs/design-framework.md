# Moneytor design framework

How screens in the web app get designed and reviewed. It combines several established frameworks, each kept for the job it does best, and drops the parts that don't fit a small personal-finance tool. PRODUCT.md says who this is for and what it must feel like; this file says how to get there.

## Why a combination

No single framework covers everything this product needs. A process model doesn't tell you how to lay out a sign-in form, a usability checklist doesn't tell you how to draw a chart, and a visual style guide doesn't tell you whether you built the right screen. So each layer below borrows from the source that is strongest at that layer.

| Layer | Source | What we take | What we leave |
| --- | --- | --- | --- |
| Process | Double Diamond (UK Design Council) | Discover → Define → Develop → Deliver, diverge before converging | Workshop rituals; for us Discover/Define is the roadmap module and PRODUCT.md |
| Need per screen | Jobs to be Done | One job statement per screen, written before layout | Market-sizing side of JTBD |
| Usability checks | Nielsen's 10 heuristics (NN/g) | The ten heuristics as the review checklist | Formal multi-evaluator scoring |
| Behavior rules | Laws of UX (Yablonski) | Hick, Fitts, Jakob, Miller/chunking, Doherty threshold, Gestalt proximity and common region | Persuasion-oriented laws (scarcity, etc.) |
| Visual craft | Refactoring UI (Wathan, Schoger) | Hierarchy by weight and color before size, spacing scale, design in grayscale first, few accents | Its default palettes and shadows |
| Forms and errors | GOV.UK Design System; web.dev sign-in and sign-up guidance | Labels above fields, error summary plus inline errors, no browser-native validation bubbles, correct `autocomplete`, show-password toggle, paste allowed, no confirm-password field | Government tone and one-question-per-page for short forms |
| Access screens | OAuth consent guidance (Google identity docs, consent red-flag guides) | Show who is asking (app name), where access goes (redirect host), and call out anything unusual | Brand-verification process (not applicable) |
| Numbers and charts | Tufte (data-ink, graphical integrity); IBM Carbon data-visualization guidelines | Show the data first, erase non-data ink, label directly instead of legends, title states the insight, 3:1 contrast for graphic marks | Tufte's minimalism taken to the point of hiding units |
| Figures in tables | Financial typesetting practice | Tabular (monospaced) numerals, right-aligned amounts, same decimals per column, sign shown in text not only color | Accounting parentheses for negatives (unfamiliar to our users) |
| Responsive | Material 3 window size classes | Compact < 600px, medium 600–839px, expanded ≥ 840px as the layout breakpoints | Material components and look |
| Components | Atomic Design (Brad Frost) | Tokens → atoms → molecules → screens, so the dashboard reuses the auth pages' parts | Strict five-level taxonomy |
| Accessibility | WCAG 2.2 AA | Contrast, focus, keyboard, labels, reduced motion, never color alone | — |

## The working loop for a screen

1. **Job.** Write the screen's job in one line: "When I …, I want to …, so I can …". If two jobs compete, it's two screens or one primary and one secondary action.
2. **Content before chrome.** List what the person must see and decide, in priority order. Lay it out in grayscale using only size, weight, and space (Refactoring UI). Color comes last and only carries meaning.
3. **States.** Default, loading, empty, error, success, disabled, and the unusual case (expired link, unknown app). Each gets real copy.
4. **Responsive.** Check compact, medium, and expanded. Nothing is "desktop only".
5. **Review.** Run the ten heuristics and the checks below. A screen ships when every check passes, not when it looks finished.

## Rules that follow from the sources

**Behavior (Laws of UX, Nielsen)**
- One primary action per screen, visually distinct and large enough to hit easily (Fitts). Destructive actions are smaller and need a deliberate step.
- Keep choices short at each step; group the rest (Hick, Miller). Settings and rare actions go one level down.
- Use the patterns people already know from other sign-in and banking screens (Jakob). Novelty belongs in the numbers' presentation, not in how a password field works.
- Feedback within 400ms: buttons show progress, results replace the form without a full reload (Doherty, visibility of system status).
- Errors say what happened and what to do next, in plain words, next to the field and in a summary (heuristic 9).

**Forms (GOV.UK, web.dev)**
- Visible labels above inputs, never placeholder-only.
- On submit with errors: an error summary at the top that links to each field, focus moved to it, and the message repeated under the field.
- `autocomplete="email"`, `current-password` on sign-in, `new-password` on sign-up and setup. Paste always allowed. One password field with a show/hide toggle.
- Validate on submit, not on every keystroke. No native validation bubbles (`novalidate`).

**Access screens (OAuth consent guidance, PRODUCT.md principle 2)**
- Always show the app's name, the account it will act for, and the host it sends you back to.
- An unfamiliar host gets a plain warning above the buttons, not a footnote. Claude's own callback and local apps are recognized and labelled as such.
- "Allow" and "Deny" are equally easy to reach; neither is hidden or pre-focused in a way that rushes the choice.

**Numbers (Tufte, Carbon, financial typesetting)**
- Tabular numerals everywhere a figure can be compared. Amounts right-aligned in tables.
- Money in and money out differ by sign and label, with color as a second cue, never the only one.
- Charts: no 3D, no decorative gridlines, direct labels, a title that says what the chart shows.
- The same number appears the same way on every screen and matches what the assistant reports.

## Sources

- Double Diamond and JTBD comparisons: [Umbrex](https://umbrex.com/resources/frameworks/strategy-frameworks/design-thinking-double-diamond/), [24 ways](https://24ways.org/2017/jobs-to-be-done-in-your-ux-toolbox/)
- [NN/g: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Laws of UX](https://lawsofux.com/book/)
- Refactoring UI summaries: [iamaatoh notes](https://iamaatoh.com/essays/refactoring-ui.html)
- GOV.UK Design System: [error summary](https://design-system.service.gov.uk/components/error-summary), [validation](https://design-system.service.gov.uk/patterns/validation/), [question pages](https://design-system.service.gov.uk/patterns/question-pages)
- web.dev: [sign-in form best practices](https://web.dev/articles/sign-in-form-best-practices), [sign-up form best practices](https://web.dev/articles/sign-up-form-best-practices)
- OAuth consent: [Google unverified apps](https://support.google.com/cloud/answer/7454865?hl=en), [consent screen red flags](https://www.alphonsolabs.com/oauth-consent-screen-red-flags/)
- Data: [Tufte's data-ink principles](https://jtr13.github.io/cc19/tuftes-principles-of-data-ink.html), [Carbon chart anatomy](https://carbondesignsystem.com/data-visualization/chart-anatomy/), [Carbon legends](https://carbondesignsystem.com/data-visualization/legends/), [alignment in tables](https://masnick.org/projects/datatips/guidelines/alignment-in-tables/)
- [Material 3 breakpoints](https://m3.material.io/foundations/layout/applying-layout)
