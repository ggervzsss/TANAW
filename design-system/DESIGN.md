---
name: TANAW
description: Visitor counting and DOT reporting for Philippine local government tourism sites.
colors:
  civic-green: "#055b25"
  civic-green-deep: "#044a1e"
  ledger-green: "#065f46"
  forest-label: "#1b4332"
  canopy-start: "#043817"
  canopy-mid: "#075526"
  canopy-end: "#0c6a32"
  seal-gold: "#d7b35a"
  gold-ink: "#8a6a12"
  seal-navy: "#2a3063"
  record-red: "#a40e0e"
  error-red: "#dc2626"
  live-green: "#45a549"
  focus-teal: "#0f766e"
  page-wash: "#eef5f0"
  page-wash-end: "#f6f8f6"
  surface: "#ffffff"
  surface-inset: "#f0f5f1"
  control-hover: "#edf4ef"
  ink: "#10241b"
  ink-secondary: "#475569"
  ink-muted: "#64748b"
  border-soft: "#d6e2d9"
  border: "#c6d6cb"
  control-border: "#cbd5d1"
typography:
  display:
    fontFamily: "Bai Jamjuree, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.9375rem"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Bai Jamjuree, Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.28125rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.03125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.90625rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "0.14em"
  badge:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
  metric:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: '"tnum" 1'
rounded:
  sm: "6px"
  md: "12px"
  lg: "16px"
  xl: "18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.civic-green}"
    textColor: "{colors.surface}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.civic-green-deep}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
    height: "42px"
  button-secondary-hover:
    backgroundColor: "{colors.control-hover}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.record-red}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px"
  metric-strip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  badge:
    rounded: "{rounded.pill}"
    padding: "4px 10px"
    typography: "{typography.badge}"
  camera-list-item-active:
    backgroundColor: "#ecfdf5"
    textColor: "{colors.ledger-green}"
    rounded: "{rounded.md}"
    padding: "12px"
  table-header:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.forest-label}"
    typography: "{typography.label}"
    padding: "10px 12px"
---

# Design System: TANAW

One design for both TANAW apps: the desktop app enterprises use at their sites, and
the web portal LGU Admin, IT and Staff use at city hall.

The look comes from the desktop app's original visual design (before the neth merge),
which the web portal already shared. The desktop page layouts and workflows come from
the neth branch. Chosen on the TANAW Identity Board on November 17, 2026: the original
look won every row and neth's layout and UX stay. The web audit the same day
([audits/web-app.md](audits/web-app.md)) settled where the two apps differed: Inter
body text with Bai Jamjuree headings, ink page titles, the pale green page wash, and
one button style.

The YAML frontmatter is normative. `tokens/tanaw.css` implements it for Tailwind v4,
including the dark theme. Where this prose and a token disagree, the token wins and
this prose is out of date.

## Overview

**Creative North Star: "The Town Hall Ledger"**

TANAW is the record a city tourism office keeps of who visited its sites. It should
feel like a well-kept municipal register: official, exact, and calm. Numbers are the
content, so they get room, alignment and weight. Color is civic: the deep green of the
city hall banner, a thin thread of seal gold, and plain white paper for the records.
Nothing on screen competes with the counts.

The page sits on a pale green wash, records sit on white cards with soft edges, and
the top navigation carries the city's identity: a deep green band with the city hall
building blended into it, the city seal, and the TANAW wordmark. Below that band the
interface is quiet and orderly, closer to a ledger than a dashboard toy.

Density is moderate. Operators work a full month of daily figures, so tables and
metric strips are compact and scannable, while forms keep comfortable touch targets.

**Key Characteristics:**

- Civic green for action and identity; seal gold only as a thin accent.
- White record cards on a pale green page wash.
- Counts in tabular figures, right-aligned in tables, large in metric strips.
- Small uppercase tracked labels name every figure.
- The topbar is the one expressive surface; everything below it is restrained.

## Colors

A civic palette: deep municipal greens, one gold thread from the city seal, and paper
white for records.

### Primary

- **Civic Green** (#055b25): the action color. Primary buttons, selected tabs, filled
  switches, progress. Hover deepens to **Civic Green Deep** (#044a1e).
- **Ledger Green** (#065f46): green as text and outline. Links, active list items, the
  selected camera's name, icons in active states.
- **Forest Label** (#1b4332): uppercase labels on metric strips and table headers.

### Secondary

- **Seal Gold** (#d7b35a): ornament only. The metric strip's accent thread, the active
  navigation underline, a single highlight per screen. Never text on white (2.0:1).
- **Gold Ink** (#8a6a12): gold that has to be read, such as an eyebrow over a page
  title. The original UI used #b7952b for this, which fails contrast on white
  (2.9:1); #8a6a12 keeps the hue at 5.1:1.

### Tertiary

- **Canopy** (#043817 to #075526 to #0c6a32): the topbar's left-to-right gradient
  under the city hall photograph. Used nowhere else.
- **Seal Navy** (#2a3063): the city seal's blue. Reserved for the seal and official
  form artwork.

### Neutral

- **Page Wash** (#eef5f0 to #f6f8f6): the page background, a 145° gradient. Flat
  areas use #f4f8f5.
- **Surface** (#ffffff): cards, tables, inputs, menus.
- **Inset** (#f0f5f1): table headers, status panels, wells inside cards.
- **Control Hover** (#edf4ef): hover fill for secondary buttons and list rows.
- **Ink** (#10241b): body text and figures; a green-black, never pure black.
- **Ink Secondary** (#475569) and **Ink Muted** (#64748b): supporting text and captions.
- **Border Soft** (#d6e2d9), **Border** (#c6d6cb), **Control Border** (#cbd5d1):
  card edges, dividers, input outlines, in that order of strength.

### Status

- **Live Green** (#45a549): the glowing "camera running" dot only.
- **Record Red** (#a40e0e): destructive actions and their outlines.
- **Error Red** (#dc2626): validation messages and failed states.
- **Focus Teal** (#0f766e): the keyboard focus ring everywhere.
- Status badges use tinted pills: success emerald, warning amber, danger red, info
  blue, neutral slate (values in `tokens/tanaw.css`). Large tinted areas such as
  banners use the matching **status surfaces** (`--tanaw-success-surface` and so on).

### Category Tones

Metric strips and work queues color each category so it can be told apart at a glance:
a 7px dot, the icon and the detail line take the tone; the count stays Ink. Tones use
Tailwind's palette (text 700, dot 500, lighter shades in dark mode): **danger** red,
**warning** amber, **info** blue, **success** emerald, **teal**, **purple** violet and
**neutral** slate. A tone names a kind of thing ("Needs immediate action", "Open
enterprise requests"); it is not decoration.

### Map and Chart Palette

Map layers and chart series may use Lime (#45a549), Yellow (#ffd200), Orange
(#ff6204), Blue (#2d5eff), Sky (#a0bbff) and Peach (#f5d2bd), plus the chart tokens
(primary #047857, secondary #2563eb). They never color buttons, text or chrome.

### Interaction States

Rows, list items, menus and selectable cards share one set of state fills: hover
(#f0fdf4 with a green outline), selected (#ecfdf5), active (#dcfce7), pressed (#d1fae5)
and disabled (#f1f5f9 with #94a3b8 text), all `--tanaw-interactive-*` tokens.

### Named Rules

**The Gold Thread Rule.** Gold appears as lines and marks, never as fills or body
text, and at most once or twice per screen. Its scarcity is what makes it official.

**The One Action Green Rule.** Only Civic Green (#055b25) fills an action. Other greens
are text, outlines or atmosphere. A filled green shape means "you can press this" or
"this is on".

**The Seal Rule.** Navy belongs to the city seal. It does not become a second brand
color: page titles are Ink, not navy.

## Typography

**Display Font:** Bai Jamjuree (with Inter, system-ui)
**Body Font:** Inter (with system-ui)

**Character:** Bai Jamjuree's squared, slightly technical letterforms give the
wordmark, page titles and section headings an official, engineered voice; Inter
carries every figure, label, sentence, table and form with plain legibility. Both apps
use the same two faces; Montserrat is retired.

The type scale is the app's own, set in `tokens/tanaw.css`: 12.5, 14.5, 16.5, 18.5,
20.5, 25, 31, 38, 49 and 61px.

### Hierarchy

- **Display** (700, 31px, 1.15): page titles such as "Camera Monitoring" and the
  "TANAW" wordmark (24px in the topbar, tracked wide).
- **Headline** (700, 20.5px, 1.2): section and card headings, "Visitor Details".
- **Title** (700, 16.5px, 1.35): camera names, button labels, table emphasis.
- **Body** (400, 14.5px, 1.5): sentences, helper text, descriptions. Keep running text
  under 70 characters per line.
- **Label** (700, 12px, 0.14em tracking, uppercase): metric names, table headers,
  section eyebrows. Forest Label on light surfaces.
- **Badge** (600, 12px, sentence case, no extra tracking): status badges, counters
  and segmented filters.
- **Metric** (600, 40px, 1, tabular figures): the large counts in metric strips.

### Named Rules

**The Ledger Number Rule.** Every count uses tabular figures. In tables, numbers are
right-aligned so digits line up down the column. A number is never set in the display
font inside a table.

**The Named Figure Rule.** Every number on screen has a label naming what it counts
and, where it matters, when ("Unique visitors · Estimated today").

## Layout

Desktop page structure follows the neth branch; this section records it so the look is
applied to those layouts without changing them. Web portal structure is its own.

- **Shell (both apps):** the topbar spans the full width (88px; 80px and 96px with the compact
  and comfortable interface scales; 72px under 640px). Content sits in a centered column up to 1880px wide with 32px
  padding, 24px under 1280px, 16px on phones.
- **Dashboard:** four metric cards in one row, then two charts side by side, then
  demographics and peak activity, then the recent-reports preview. An assistant panel
  can open beside the content (300px).
- **Camera Setup:** a collapsible camera list on the left (190–230px, 176px under
  900px) and the selected camera's preview with live metrics on the right. Camera
  settings open in a panel with vertical tabs and a fixed action footer.
- **Reports:** Create Reports and Reports History as tabs. The monthly report card
  spans the width; Visitor Details sits beside the Next Steps panel.
- **Web portal pages:** a page title, then a metric strip of four or five figures, then
  the working area: a work queue, a filterable table, or a two-column split with a
  status side panel. Admin, IT and Staff portals share the shell and differ only in
  their navigation.
- **Rhythm:** a 4px base. Gaps of 8, 12 and 16px inside components, 16–24px between
  cards, 32px between page regions.
- **Responsive:** grids collapse to one column at phone width; tables scroll inside
  their own container rather than widening the page.

## Elevation & Depth

Depth is soft and layered: cards barely lift off the page wash, and only floating
things (menus, dialogs, the topbar) cast a real shadow. Dark mode deepens the shadows
instead of lightening surfaces.

### Shadow Vocabulary

- **Resting** (`box-shadow: 0 1px 2px rgb(0 0 0 / 0.05)`): cards and tables at rest.
- **Soft** (`box-shadow: 0 12px 30px rgb(15 23 42 / 0.08)`): hovered cards, the camera
  list panel, popovers.
- **Raised** (`box-shadow: 0 18px 42px rgb(15 23 42 / 0.12)`): menus, dialogs, toasts.
- **Banner** (`box-shadow: 0 16px 40px rgb(2 20 8 / 0.34)`): the topbar only.

### Named Rules

**The Paper Rule.** Records rest flat on the page. A shadow is earned by floating above
other content, not by being important.

## Shapes

Gently rounded and consistent. Cards and the metric strip use 16px corners, controls
and list items 12px, compact selects 6px, and badges are full pills. The camera list
panel uses 18px. Borders are thin (1px) and green-grey, never black.

## Components

### Buttons

Confident and plain.

- **Shape:** gently rounded (12px).
- **Primary:** Civic Green fill, white bold label, 42px tall with 16px side padding.
  Hover deepens to Civic Green Deep; press moves down 1px.
- **Secondary:** white with a Control Border outline and Ink label; hover fills with
  Control Hover.
- **Danger:** white with a Record Red label and a light red outline.
- **Focus:** a 2px Focus Teal ring offset by 2px.
- **Disabled:** 50% opacity, no hover change.
- **Case:** sentence case, never uppercase with wide tracking ("Open live map", not
  "OPEN LIVE MAP").

**The One Button Rule.** Every action is the same 12px button in sentence case. Pills
are reserved for things that are not actions: status badges, counters and segmented
filters.

### Badges

- **Style:** tinted pill with a matching 1px outline and dark text of the same hue
  (12px, 600). An optional leading dot for live states.
- **State:** success emerald, warning amber, danger red, info blue, neutral slate.
- **Case:** sentence case, with no wide tracking ("Running", "5 unavailable", "In
  review", not "RUNNING"). Acronyms keep their capitals ("ML service ready"). Status
  values that arrive in Title Case or as machine values go through `toSentenceCase`
  (`src/utils/sentence-case.ts` on the desktop, `src/shared/utils/sentenceCase.ts` on
  the web); never apply it to names people typed.

**The Quiet Badge Rule.** Uppercase belongs to labels that name a figure or a column.
A badge states a condition, so it reads as a short sentence.

### Cards / Containers

- **Corner Style:** 16px.
- **Background:** Surface on the Page Wash; Inset for wells inside a card.
- **Shadow Strategy:** Resting; Soft on hover where the whole card is clickable.
- **Border:** 1px Border Soft.
- **Internal Padding:** 16px, 20–24px for primary panels.

### Inputs / Fields

- **Style:** white fill, 1px Control Border, 12px corners, 40px tall, Ink text,
  placeholder #7b8492.
- **Focus:** border turns Ledger Green and a soft green ring appears.
- **Error / Disabled:** Error Red border and message below; disabled fills #f1f5f9.

### Segmented Filters

A row of pill-shaped choices that filter one list ("Needs attention", "Escalated
support", "Account requests"), each with a count pill. Sentence case. The selected
choice fills with Civic Green and white text; the rest are plain text with a muted
count.

### Search Fields

An input with a leading search icon and a muted placeholder that says what can be
searched ("Search name or email").

### Selects and Switches

- **Select:** same shell as an input with a chevron; its menu is a Raised white panel
  with 12px corners, a check mark on the selected option and keyboard navigation.
- **Switch:** Civic Green track when on, slate when off, white thumb.

### Navigation

- **Topbar (signature):** the Canopy gradient with the city hall photograph blended in
  from the right (day image at 55% opacity, night image in dark mode), the city seal
  in a translucent circle, the TANAW wordmark in Bai Jamjuree, and "Enterprise Portal"
  as a tracked label. Links are white; the active link carries a short underline.
  Theme, notifications and the account menu sit at the right in glass circles.
- **Portal label:** the tracked label after the wordmark names the app: "Enterprise
  Portal" on the desktop, "Admin Portal", "IT Portal" or "Staff Portal" on the web.

### Metric Strip (signature)

One white card holding several figures side by side, separated by fading vertical
dividers, with a 5px accent thread across the top (forest → gold → leaf:
#1b4332, #c5a047, #5a8c46). Each figure has an uppercase label, a 40px tabular count
and a one-line detail. It scrolls sideways on narrow screens instead of wrapping.
Each figure may carry a Category Tone on its icon, dot and detail line.

### Tables

Inset header row with uppercase tracked labels in Forest Label, 1px Border Soft row
dividers, tabular figures right-aligned, totals in bold. Wide tables scroll inside
their own container.

### Empty States

A 48px Inset tile holding the section icon in Ledger Green, a bold one-line title ("No
LGU accounts") and one muted sentence saying what will appear or what to do next.

### Dialogs

Raised white panel, 16px corners, a Bai Jamjuree title, content, and actions at the
bottom right (secondary before primary). Detail dialogs show fields as label and value
pairs.

### Login (signature, web)

A full-bleed photograph of the San Pedro welcome arch under a green grade, the welcome
headline in Bai Jamjuree with a short gold rule, and a white sign-in card with the
TANAW Portal wordmark, a gold divider with the flower mark, and the Civic Green
sign-in button.

### Map View (web)

The live map fills the working area. Establishments are markers in the Map and Chart
Palette; panels over the map are Raised white cards with 16px corners.

### Camera List Item

A 12px-cornered row with the camera name in bold, zone and mode below in Ink Muted,
and the Live Green dot at the right when running. The selected camera gets a pale
emerald fill (#ecfdf5), a Ledger Green outline and name.

## Do's and Don'ts

### Do:

- **Do** fill actions with Civic Green (#055b25) only; use Ledger Green (#065f46) for
  green text and outlines.
- **Do** set every count in tabular figures and right-align numbers in tables.
- **Do** label every figure with a short uppercase label in Forest Label (#1b4332).
- **Do** keep cards white on the Page Wash with 16px corners and the Resting shadow.
- **Do** show keyboard focus with the 2px Focus Teal ring on every control.
- **Do** keep neth's page layouts and flows when applying this look.

### Don't:

- **Don't** set text in Seal Gold (#d7b35a) or the original #b7952b on white; use
  Gold Ink (#8a6a12).
- **Don't** introduce new greens. Map any green to Civic Green, Ledger Green, Forest
  Label or Canopy.
- **Don't** use neth's 28px card corners, 54px buttons, Arial type or muted #335d43
  green.
- **Don't** use pure black text or pure black borders.
- **Don't** use the Canopy gradient or the city hall photograph outside the topbar.
- **Don't** put large display numbers inside tables.
- **Don't** set page titles in navy, or any text in Montserrat.
- **Don't** make buttons uppercase or pill-shaped.
- **Don't** make status badges uppercase or widely tracked.
- **Don't** use the Map and Chart Palette for buttons, text or page chrome.
