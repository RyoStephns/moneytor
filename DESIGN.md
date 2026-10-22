---
name: Moneytor
description: Personal finance tracker; the web app is where people sign in, approve an AI connector, and read their numbers.
colors:
  zone-0: "oklch(0.17 0 0)"
  zone-1: "oklch(0.25 0 0)"
  zone-2: "oklch(0.33 0 0)"
  zone-3: "oklch(0.41 0 0)"
  zone-4: "oklch(0.5 0 0)"
  zone-5: "oklch(0.59 0 0)"
  zone-6: "oklch(0.68 0 0)"
  zone-7: "oklch(0.77 0 0)"
  zone-8: "oklch(0.86 0 0)"
  zone-9: "oklch(0.935 0 0)"
  zone-10: "oklch(0.985 0 0)"
  magenta: "oklch(0.52 0.23 350)"
  magenta-ink: "oklch(0.45 0.2 350)"
  magenta-tint: "oklch(0.93 0.05 350)"
typography:
  display:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "0.005em"
    fontVariation: "'wdth' 62"
  display-compact:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "0.005em"
    fontVariation: "'wdth' 62"
  wordmark:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 62"
  headline:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 700
    letterSpacing: "0.03em"
    fontVariation: "'wdth' 75"
  title:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 75"
  lede:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.45
  body-large:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.45
  body:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum'"
  small:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo Variable, Archivo, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 650
    letterSpacing: "0.09em"
    fontVariation: "'wdth' 75"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.92em"
    fontWeight: 400
    fontFeature: "'tnum', 'liga' 0"
  mono-code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.125rem"
    fontWeight: 400
    fontFeature: "'tnum', 'liga' 0"
rounded:
  none: "0px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  topbar:
    backgroundColor: "{colors.zone-0}"
    textColor: "{colors.zone-10}"
    padding: "12px 32px"
    height: "60px"
  button-primary:
    backgroundColor: "{colors.zone-0}"
    textColor: "{colors.zone-10}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.zone-1}"
  button-primary-busy-segment:
    backgroundColor: "{colors.magenta}"
    textColor: "{colors.zone-10}"
  button-secondary:
    backgroundColor: "{colors.zone-10}"
    textColor: "{colors.zone-0}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "52px"
  button-secondary-hover:
    backgroundColor: "{colors.zone-9}"
  button-quiet:
    textColor: "{colors.zone-0}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "40px"
  button-quiet-hover:
    backgroundColor: "{colors.zone-9}"
  button-hold-back:
    textColor: "{colors.zone-0}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "40px"
  input:
    backgroundColor: "{colors.zone-10}"
    textColor: "{colors.zone-0}"
    rounded: "{rounded.none}"
    padding: "12px"
    height: "48px"
  record-card:
    backgroundColor: "{colors.zone-10}"
    rounded: "{rounded.none}"
    padding: "32px"
  record-key-row:
    backgroundColor: "{colors.magenta-tint}"
    textColor: "{colors.magenta-ink}"
  notice-warn:
    backgroundColor: "{colors.magenta-tint}"
    textColor: "{colors.zone-0}"
    padding: "16px 24px"
  error-summary:
    backgroundColor: "{colors.zone-10}"
    textColor: "{colors.zone-0}"
    padding: "16px 24px"
  key-figure:
    backgroundColor: "{colors.magenta-tint}"
    textColor: "{colors.zone-0}"
    padding: "12px"
  bar-in:
    backgroundColor: "{colors.zone-0}"
  bar-out:
    backgroundColor: "{colors.zone-9}"
    textColor: "{colors.zone-0}"
---

# Design System: Moneytor

Process, usability checks, form and consent rules, number typesetting and breakpoints come from the combined framework in [docs/design-framework.md](docs/design-framework.md); product principles are in [PRODUCT.md](PRODUCT.md). This file records only the visual system as built in `web/src/styles.css` and `web/src/ui.tsx`.

## Overview

**Creative North Star: "The Exposure Record"**

Every screen is a printer's exposure record. Whatever is being granted or measured sits as a ruled entry on a record card, laid over one fixed neutral ramp. The ground is achromatic grey, never cream. Ink sits at the dark end of an eleven-step zone ramp, and every neutral on the page comes from that ramp. The wordmark carries the ramp as a strip of eleven swatches, so the scale is the identity.

One dichroic magenta marks the decision in focus and nothing else: the active nav item, the key row of a record, the primary button's consequence segment while it applies, and on the dashboard the net key figure, today on the pace chart, and the one category furthest over its usual. Titles and legends use condensed, tracked capitals cut from the same variable family as the body, and every figure is set in tabular numerals. Corners are square throughout. Depth is one soft sheet shadow plus a tracing sheet offset behind the record card.

Hatching is the system's second signal, used where a colour accent would be ambiguous. It means conflict, error or held back (an unknown return host, a revoked or expired invite, an invalid field, a revoke action). It never decorates and never encodes a balance.

**Key Characteristics:**
- Achromatic zone ramp (chroma 0) as the only neutral scale.
- One accent, magenta, reserved for the decision in focus.
- Condensed tracked caps (Archivo at 62–75% width) for display, titles and row legends; regular width for body.
- Hairline-ruled record tables with a 2px ink head rule.
- Square buttons; the primary carries a value segment that names the consequence.
- Hatching and crosshatching for conflict, error and held-back states, never red.

## Colors

A grey zone ramp with no chroma, one magenta for the decision in focus, and no other hue.

### Primary
- **Dichroic Magenta** (`magenta`): the decision in focus. Used for the active nav underline, the focus ring (2px, 2px offset), the input caret, the busy fill of the primary button's value segment, the border of the warning notice, the border of a conflict hatch, and the 2px today rule on the pace chart. It is never used to fill a resting button or a large area.
- **Magenta Ink** (`magenta-ink`): text on magenta tint, and the today reading on the pace chart. Used for the key row's legend, the key figure's legend and usual note, the worst category's legend and deviation, and the warning notice's icon.
- **Magenta Tint** (`magenta-tint`): background of the key row, the key figure block, the worst-category step, the conflict row, the warning notice and text selection.

On the dashboard, each sheet carries at most one magenta mark: the net key figure on the period record, the today rule on the pace sheet, and on the step-down only the category furthest over its usual (more than 10% over; none when nothing is).

### Neutral
The eleven zone steps are evenly spaced in OKLCH lightness from 0.17 to 0.985. Semantic aliases map onto them:
- **Ink** (`zone-0`): body text, primary button fill, top bar, the head rule of a record, error frames and marks, money-in bars, the frame of money-out bars, the usual tick, and the pace line and its baseline.
- **Hover Ink** (`zone-1`): primary button hover.
- **Strong Rule** (`zone-2`): record card border, input border, quiet button border, lede text.
- **Secondary Ink** (`zone-3`): row legends, hints, muted copy, revoked and expired states, the dashed pace reference and chart axis dates.
- **Placeholder** (`zone-4`): input placeholder only.
- **Hairline** (`zone-7`): row rules, section dividers, tracing sheet border.
- **Shimmer** (`zone-8`): skeleton loading, nav link text on the top bar.
- **Ground** (`zone-9`): page background, secondary hover, reveal toggle, the fill inside hollow money-out bars.
- **Sheet** (`zone-10`): record card paper, inputs, text on ink.
- `zone-5` and `zone-6` appear only in the ramp strip and the scrollbar thumb.

### Named Rules
**The One Accent Rule.** Magenta is the only hue. It marks what the person is deciding right now: the active page, the key row, the busy primary. If two things on a screen compete for magenta, one of them is wrong.

**The No Red Rule.** Errors are carried by ink and structure: a 2px ink frame, the crosshatch mark, and the "Error:" prefix (in the document title and as visually hidden text before each inline message). Never red, and never magenta alone.

**The Ink In, Hollow Out Rule.** In every chart, money in is a solid ink bar and money out is a hollow bar (ground fill inside a 1.5px ink frame). The usual amount is a 2px ink tick or a dashed secondary-ink line. Over and under read as distance on one scale, never as a colour.

**The Hatch Means Trouble Rule.** Hatching (single 135° lines) means held back: revoked or expired invites, the revoke button on hover. Crosshatching (135° plus 45°) means conflict or error: the unknown-host row, the invalid field band, the error mark and the summary mark. Neither ever fills a figure, a balance or a decoration.

## Typography

**Display Font:** Archivo Variable, width axis (fallback Archivo, system-ui, sans-serif), self-hosted via `@fontsource-variable/archivo`
**Body Font:** Archivo Variable at 100% width
**Label/Mono Font:** JetBrains Mono 400/500 (fallback ui-monospace) for codes, tokens and addresses

**Character:** a single grotesque family ranked by width, weight and case rather than by switching faces. Condensed caps read as the legend on a printed record, and regular-width text reads as the entry.

### Hierarchy
- **Display** (650, 62% width, uppercase, 2.75rem; line-height 1, balanced wrap): one page title per screen.
- **Display compact** (same voice at 2.125rem): the display under 600px.
- **Wordmark** (700, 62% width, uppercase, 1.375rem, 0.04em tracking): MONEYTOR in the top bar only.
- **Headline** (700, 75% width, uppercase, 1.4375rem): the record card's own title (for example ACCESS REQUEST, INVITES, PEOPLE). It sits inside the sheet.
- **Title** (700, 75% width, uppercase, 1.1875rem) over a hairline rule: subsections inside a card.
- **Lede** (400, 1.1875rem / 1.45, max 60ch, `zone-2`): one sentence under the display.
- **Body large** (400, 1.0625rem): text typed into inputs, and the lede under 600px.
- **Body** (400, 16px / 1.5, tabular numerals everywhere): record values are set at 600, and descriptive values drop to 400.
- **Small** (0.9375rem, 15px): the step below body. Used for hints, inline errors, `.small` notes, record notes, the after-card footer, top-bar nav, the primary's value segment, quiet and hold-back buttons, and the Show/Hide toggle. Weight follows the role: 400 for hints and notes, 600–650 for errors and controls.
- **Label / Legend** (650, 75% width, uppercase, 0.8125rem, 0.09em tracking, `zone-3`): record row labels, table column heads, and the labels on stacked phone records.
- **Field label** (650, 1rem, sentence case): form labels stay in sentence case and are never set in legend caps.
- **Mono code** (JetBrains Mono 400, 1.125rem): the one-time invite code in the fresh-code block, set large enough to read back and copy by eye. Elsewhere mono stays at 0.92em of its context.
- **Step numerals** (700, 62% width, 1.4375rem): ordered steps whose numbers carry a real sequence.
- **Key figure** (650, 75% width, 2.125rem / 1.05, 0.005em tracking, never wraps): the one number read first, the net in the dashboard's key figure block. Signed with a true minus or plus.
- **Chart labels** (600, 0.8125rem, secondary ink, sentence case): axis dates on the pace chart. The today reading uses 650 in magenta ink.

### Named Rules
**The Legend Voice Rule.** Every label that names a record field (row headers, column heads, the `data-label` on phone cards) uses the legend voice: condensed, tracked, uppercase, secondary ink. Values are never set in this voice.

**The Tabular Everywhere Rule.** `tabular-nums` is set on the body, so every figure lines up. Mono turns off ligatures.

## Layout

Single column, centred. Pages are `min(100% − 48px, 760px)` wide, admin-style pages widen to 1080px, and the dashboard widens to 1240px (below). Vertical page margins are 64px (32px top on phones). The page header sits 32px above the first sheet, and stacked sheets are 32px apart. Spacing uses an 8-step scale from 4px to 64px (`s1`–`s8`); inside forms, fields are 24px apart and label, hint and error are 8px apart.

Breakpoints follow the framework's compact class at 600px. Under 600px:
- **Key-value records** (`stack-sm`) become one column, with the legend above its value.
- **Data tables** (`cards-sm`) become stacked labelled records. The column head is visually hidden, each cell prints its legend from `data-label` in a 6.5rem column, and action cells drop the label.
- **Action rows** go full width. A primary button whose value segment is text stacks that segment under the label, separated by a top rule instead of a side rule, so neither part breaks mid-word.
- The top bar wraps and drops the signed-in email.
- Card padding shrinks to 24px × 16px, and the tracing-sheet offset shrinks to 6px × 8px.

Above 600px, wide tables keep full columns inside a horizontal scroller with a 560px minimum (520px for the month-by-month table).

**Dashboard: the record beside its working sheets.** The dashboard page is `min(100% − 48px, 1240px)` wide. From 840px up it is two columns: a record column of 340–400px and the working sheets in the remaining width, with a 48px column gap and 32px row gap. The record column holds the page display, lede, filter fields and the period record card, and is sticky 24px from the top while the sheets scroll. The working sheets stack 32px apart. Below 840px it is one column in the same order, record first. Under 600px the page is `100% − 32px` wide with a 32px top margin.

On phones, the dashboard's **labelled tables** (`cards-sm labelled`) hold several amounts per row, so every amount keeps its legend in the 6.5rem column instead of dropping it. A cell holding paired bars takes the full width without a legend. Empty cells in a total row are hidden, and the total row is headed by a 1px ink rule. The step-down list re-flows to two lines per step: legend and amount share the first line, and the track sits beside a fixed 4.75rem deviation column on the second.

## Elevation & Depth

The system is flat, with one physical metaphor: paper on a desk. A record card is a sheet with a single soft shadow. A primary record card (`sheet stacked`) also has a translucent tracing sheet behind it, offset 14px × 12px and rotated 1.1°. Nothing else lifts. Buttons, inputs, notices and summaries are flat and framed by rules.

### Shadow Vocabulary
- **Sheet shadow** (`box-shadow: 0 18px 32px -20px oklch(0.17 0 0 / 0.35), 0 2px 4px -2px oklch(0.17 0 0 / 0.12)`): record cards only.

### Named Rules
**The Paper Only Rule.** Depth belongs to record cards. Use one sheet shadow, plus at most one tracing sheet behind the main record on a screen. Controls never cast shadows.

## Shapes

Every corner is square (0px): buttons, inputs, cards, notices and status marks. Form comes from rules. A 1px strong-rule border frames a card, a 2px ink rule heads a record table, 1px hairlines separate rows, and 2px ink frames mark an error state. Status marks are 12px squares with a 1.5px ink border: hollow for waiting, solid for used or active, hatched for revoked, expired or disabled. Icons are 24px-grid SVG line icons with a 1.75 stroke and square caps.

## Components

### Buttons
Square, framed in ink, and they state their consequence.
- **Shape:** square (0px), 1px ink border, 52px tall, label 650 at 1rem.
- **Primary:** ink fill with sheet text. An optional **value segment** sits after a 1px rule and names what the click does: the return host, the invite lifetime, "Uses the invite", "As owner". While `aria-busy` is set, the segment fills magenta, sweeping left to right over 420ms on `cubic-bezier(0.16, 1, 0.3, 1)`. At rest the segment is never magenta. `grow` buttons stretch and push the segment to the far edge.
- **Hover / Focus:** primary moves to `zone-1`, and secondary moves to ground. Focus is the global 2px magenta outline at a 2px offset. Disabled is 0.55 opacity with a not-allowed cursor.
- **Secondary:** sheet fill, ink border, same height. Used for the equal-weight alternative (Deny beside Allow).
- **Quiet:** 40px, strong-rule border, transparent. Used for copy and utility actions, often with an icon.
- **Hold-back (revoke):** 40px, ink border, transparent. On hover it fills with the single hatch, so the action reads as holding something back rather than as danger red.

### Record Card
The signature container.
- **Corner Style:** square.
- **Background:** sheet paper (`zone-10`) on the grey ground.
- **Shadow Strategy:** the sheet shadow. The primary record adds the offset tracing sheet (see Elevation & Depth).
- **Border:** 1px strong rule.
- **Internal Padding:** 32px (24px × 16px on phones).
- **Title:** the card carries its own headline in condensed caps (ACCESS REQUEST, INVITES, CONNECT YOUR ASSISTANT). The page display stays above the card.

### Record Table
A ruled table under a 2px ink head rule, with 12px cell padding and 1px hairline rows. Row headers sit in the legend voice at 34% width. Values are 600, and descriptive values are 400. Amounts align right. The **key row** (the fact the decision turns on, such as Returns to or a freshly issued invite) takes the magenta tint, with its legend in magenta ink. A **conflict row** keeps the tint and adds a 48px crosshatch band at 55% magenta on its trailing edge, behind a 1px magenta rule. A note line (400, 0.9375rem, `zone-2`) explains the value. On phones, tables stack as described in Layout.

### Inputs / Fields
- **Style:** label above (sentence case, 650), optional hint below it (`zone-3`), then the input. The input is 48px, sits on sheet paper with a 1px strong-rule border and square corners, and uses 1.0625rem text. Codes and tokens use mono. Secret fields attach a square Show/Hide toggle on ground.
- **Focus:** the border moves to ink, plus the magenta outline at a 0 offset. The caret is magenta.
- **Error:** a 2px ink frame plus a 14px crosshatch band on the trailing edge of the input. The message sits above the input, after a 14px crosshatched square mark, in 650 ink, with a visually hidden "Error:" prefix. On submit, an **error summary** (2px ink frame, crosshatched 18px mark before "There is a problem", linked list of messages) takes focus at the top, following the GOV.UK pattern in the framework.

### Navigation
The top bar is an ink strip, at least 60px tall. On the left is the wordmark: the eleven-swatch ramp strip, then MONEYTOR in 700 at 62% width, tracked caps. Nav links (Dashboard, Account, and Invites & people for the owner) sit on the right at 0.9375rem in `zone-8`. Hover and the current page go to `zone-10`, and the current page also gets a 2px magenta underline. Sign out is a link-styled button. On phones the bar wraps and hides the email.

### Key Figure
The one number read first, set above the record table at full card width. A block on magenta tint under a 2px ink head rule, padded 12px: the legend (NET) in magenta ink, the figure in the key-figure voice in ink, and a small note in magenta ink giving the usual amount for the same number of days. The record table under it starts with a 1px hairline instead of its own ink head rule, and its row headers narrow to 30%.

### Step-down List
The dashboard's signature. Income at the top as a solid ink bar; each expense category below it is a hollow bar that eats into what is left, and the last row (Net left, or Overspent) shows what remains. Every step sits on the list's own columns through a subgrid (7.5rem legend, track, amount, 5.5rem deviation), so all tracks share one width and therefore one scale; the scale runs from the lowest point reached (below zero when overspent) up to income. Tracks are 20px tall. The usual amount for each category is a 2px ink tick extending 5px above and below the track. A header row (CATEGORY, THIS PERIOD, VS USUAL) is set in the legend voice over a 2px ink rule; steps are separated by hairlines, and the total step has a 1px ink rule above and its amount at 700, 1.1875rem. Amounts are 600 and right-aligned; deviations are 600 at 0.9375rem in strong-rule grey. The category furthest over its usual takes the magenta tint with its legend and deviation in magenta ink, and a footnote names it in words.

### Pace Chart
A 220px SVG of cumulative expense as a step line (2.5px ink, mitred joins) over a 2px ink baseline. The derived reference (the average month spread evenly) is a dashed 2px secondary-ink line (6px dash, 6px gap), and the sheet's note says it is derived. While the range includes today, a 2px magenta rule marks today, with its reading (Today and the running total) in magenta ink at its top, flipped to the left near the right edge. Start and end dates sit under the baseline; an open period's end is marked "(est.)". The sheet's title states the reading in words (for example SPENDING 21% UNDER YOUR USUAL PACE).

### Month-by-month Bars
Each month row pairs two 12px bars on one scale shared across the visible months: a solid ink bar for in above a hollow bar for out, each followed by its amount in a 9.5rem right-aligned column. Net sits in its own column. Bars keep a 2px minimum width so a tiny month still shows a mark.

### Notices
A plain notice is framed by a 1px strong rule on sheet paper. A **warning notice** (used for the unknown return host) has a 2px magenta border on magenta tint, with an alert icon in magenta ink and a bold lead line. It sits above the action row, never as a footnote.

### Fresh Code
A one-time secret appears in a block with a 2px ink frame on sheet paper. The code is set in mono at 1.125rem, with quiet Copy buttons beside it.

## Do's and Don'ts

### Do:
- **Do** take every neutral from the zone ramp (`zone-0`–`zone-10`); add no other greys.
- **Do** keep magenta to the decision in focus: active nav, key row, key figure, busy value segment, focus ring, warning notice, the today rule on a pace chart, and the one category furthest over its usual.
- **Do** draw money in as solid ink and money out as hollow ink-framed bars on one shared scale, with the usual as a 2px ink tick or a dashed secondary-ink line.
- **Do** give each record card its own condensed-caps title, and set every row and column label in the legend voice.
- **Do** carry errors with an ink frame, the crosshatch mark and an "Error:" prefix.
- **Do** put the consequence of a primary action in its value segment, and fill the segment magenta only while `aria-busy` is set.
- **Do** stack data tables into labelled records under 600px, and stack a text value segment under its button label on phones.
- **Do** keep every corner square and every figure tabular.

### Don't:
- **Don't** use red, or any hue other than magenta, for errors, warnings or money out.
- **Don't** hatch anything that isn't a conflict, error or held-back state. Never hatch balances or decorative fills.
- **Don't** fill a resting button or a large area with magenta.
- **Don't** use a cream or tinted ground; the ground has zero chroma.
- **Don't** round corners or give controls their own shadows.
- **Don't** add a second display face. Rank type by width, weight and case within Archivo.
