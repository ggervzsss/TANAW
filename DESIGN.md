# TANAW design guide

TANAW has two apps: the **desktop app** establishments use on site, and the **web portal** LGU
Admin, IT and Staff use at city hall. Both should feel like one civic record: official, exact
and calm, with the counts as the content. This page sets the shared identity. Everything else,
including layout, navigation, spacing, density and workflows, belongs to each app.

Each app owns its own components and styles: `frontend-tanaw/src/shared/ui-kit/` and
`desktop-tanaw/src/ui-kit/`, with tokens in each app's `src/styles/tokens.css`. Change one app
without touching the other. Keep the brand values below in step across both.

## Shared identity

**Logo.** The standalone TANAW eagle logo is a 2048 × 2048 PNG with dark green artwork on a white
background. Use it in topbars and sign-in or account verification headers. In a topbar it sits
whole in a 48 px white circle (36 px on phones) with a faint white ring. Each app keeps a local
copy in its assets directory ([web portal](frontend-tanaw/assets/tanaw-logo.png) and
[desktop app](desktop-tanaw/assets/tanaw-logo.png)).

**Type.** Bai Jamjuree (400–700) for the TANAW wordmark and page titles. Inter for everything
else: section headings (weight 650), body, labels, tables, forms and figures. Both are bundled in each app's
`public/fonts` under the SIL Open Font License; never load them from a CDN. Counts use tabular
figures, and numbers in tables are right-aligned.

**Brand colors.**

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Civic Green (action) | `#055b25`, hover `#044a1e` | `#055b25`, hover `#0a6e33` | The only fill for primary actions, selected states and "on" |
| Ledger Green (green text) | `#065f46` | `#6ee7b7` | Links, active items, green text and outlines |
| Seal Gold (line) | `#d7b35a` | `#fcd34d` | Thin accents only, once or twice per screen; never a fill |
| Gold Ink (readable gold) | `#8a6a12` | `#f3c96b` | Gold that must be read, such as an eyebrow |
| Focus ring | `#0f766e` | `#5eead4` | 2px keyboard focus on every control |

**Light palette.** Page `#f4f8f5` (pale green wash), surface `#ffffff`, inset `#f0f5f1`, ink
`#10241b`, secondary `#475569`, muted `#5f6f84`, borders `#d6e2d9` and `#c6d6cb`.

**Dark palette.** Page `#0b141d`, surface `#151f2b`, raised `#192531`, inset `#101923`, ink
`#f1f5f4`, secondary `#b8c2cb`, muted `#8f9daa`, borders at 14% and 22% of `#aebcc9`. Dark mode
follows the `.dark` class on `<html>`; deepen shadows rather than lightening surfaces.

**Status.** Live `#45a549` for the running-camera dot only, destructive `#a40e0e`, errors
`#dc2626`; badges are tinted pills (success emerald, warning amber, danger red, info blue,
neutral slate). The Canopy gradient (`#043817` → `#075526` → `#0c6a32`) stays in the topbar.
The city seal's navy `#2a3063` stays in official artwork.

## Rules both apps keep

- Only Civic Green fills an action; other greens are text, outlines or atmosphere.
- Text is never pure black, and gold is never body text on white.
- Buttons, badges and labels use sentence case; uppercase tracked labels are kept for table
  column headers only.
- Every count has a label saying what it counts and, where it matters, when.
- Text meets WCAG AA contrast in both themes; every control has a visible focus state and
  works from the keyboard. Dialogs keep focus inside, close on Escape and return focus.
- Official report forms and their print and PDF output follow the DOT layouts, whatever the
  app's own style.

## Default UI style

The desktop app's redesign (Dashboard, General Settings, Camera Setup, Reports, Help Center) is
the default look for every new or reworked screen in both apps. Reach for it unless a screen
has a stated reason not to (an official DOT form, for example).

- **Open, not boxed.** No cards: no tile that is a border, a fill and a shadow at once. Sections
  are separated by a hairline (`--tanaw-border-soft`) and air; lists are rows split by hairlines.
  Dialogs, popovers and toasts are the only raised surfaces.
- **Green accent at the top.** Every page sits on a Civic Green wash under the topbar
  (`--tanaw-top-wash`: deepest at the edge, gone by about 22rem, scrolls away with the page).
  A page title carries the civic line under it: a short green, Seal Gold, green bar that draws
  in once.
- **60-30-10.** About 60% neutral surface, 30% ink and hairlines for structure, 10% Civic Green
  for what is current, chosen or the one action to take. Seal Gold stays a thin mark.
- **Type scale.** Page title in Bai Jamjuree 700 (28–36px, tight tracking); section headings in
  Inter 650 (15–22px); body 14–16px; labels and captions 13px; nothing below 12px. Figures use
  tabular numbers.
- **Spacing.** A 4px base, used in steps of 4 and 8 (8, 12, 16, 24, 32, 48). Rows keep at least
  12px clear of a scrollbar, and the scrollbar lane is reserved so content never shifts.
- **Soft edges.** Radii 8 (chips), 12 (controls, rows, hover tints), 16 (dialogs, previews),
  20–24 (hero surfaces). Shadows are soft and rare.
- **Quiet interaction.** Rows and options tint on hover (`--tanaw-control-hover`) and take the
  green tint (`--tanaw-selected-bg`) when chosen. A selection highlight glides between options
  rather than jumping. Radio choices are rows with a dot, not tiles.
- **Tinted controls.** Fields, dropdown triggers and quiet buttons are a soft translucent tint
  (`--tanaw-control-bg`), never white boxes on the page. On focus a field lifts to the surface
  colour with an accent edge and a soft halo. Only the one primary action is solid Civic Green;
  it lifts a pixel and catches a sweep of light on hover, and every button settles when pressed.
- **Toasts.** One look in both apps: a small pane of frosted glass under the topbar with a tinted
  round icon in its tone, the message, a quiet dismiss button and a hairline along the foot that
  runs down the time left (paused while the pointer rests on it). It springs in from just above,
  the others slide to make room, and it leaves by lifting and fading, faster than it came.
- **Sign-in.** The San Pedro photo fills the stage; the form sits on one compact floating panel of
  frosted glass, as tall as its content. The primary action is flat Civic Green with a hairline of
  light, and lifts onto a soft green glow with one sweep of light on hover.
- **Loading.** Content that loads shows a skeleton in its own shape, with the shared calm
  shimmer; fast loads show no placeholder at all. Never a bare spinner for page content.
- **Motion.** 150–260ms on `cubic-bezier(0.2, 0.8, 0.2, 1)`; a section fades up a few pixels when
  it changes; live values glide to new readings. `prefers-reduced-motion` turns movement off
  and keeps state changes.
- **Usability.** Nielsen's heuristics guide each screen: the system says what it is doing (live
  tags, saving status), uses the user's words, keeps actions reversible (Cancel, Back), stays
  consistent across pages, prevents errors before they happen, and keeps help one step away.
- **Charts.** Bars for counts, a line for a level over time, a soft band for the usual range;
  every series is named in a legend in plain words, and pointing at a period names its figures
  as keyed text beside it, not in a box.

## What each app decides

Layout, navigation, page structure, density and workflows are each app's choice, as long as the
identity, the rules and the default UI style above hold. Record an app-specific convention in
that app's README or beside the code that uses it, not here.
