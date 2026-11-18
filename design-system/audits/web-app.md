# Web app audit (November 17, 2026)

Audit of `frontend-tanaw` against [DESIGN.md](../DESIGN.md), which was first written from
the desktop app. Goal: one TANAW design for both apps.

**Method:** 36 screenshots of every main page for the Admin, IT and Staff portals and
the login page, in light and dark mode (`TANAW_DESIGN_CAPTURE=<folder> npx playwright
test design-screens` from `frontend-tanaw`), plus a scan of the web stylesheets
(`src/styles/*.css`, 478 hard-coded colors) and components (116 hard-coded color
classes).

## Already shared

The web app comes from the same design lineage as the desktop app's original UI. These
need no decision:

| Element       | Web                                                                                           | Desktop (DESIGN.md) |
| ------------- | --------------------------------------------------------------------------------------------- | ------------------- |
| Topbar        | Canopy green band, city hall photograph, seal, TANAW wordmark, portal label                   | Same                |
| Metric strip  | `UnifiedMetricsHeader`: one card, forest-gold-leaf thread, uppercase tracked labels, dividers | Same                |
| Brand colors  | `tanaw-green` #055b25, navy #2a3063, red #a40e0e, gold #d7b35a                                | Same                |
| Dark palette  | #0b141d page, #151f2b surface, #34d399 / #6ee7b7 greens, #fcd34d gold                         | Identical values    |
| Cards         | White, 16px (`rounded-2xl`) corners, soft shadow                                              | Same                |
| Status badges | Tinted pills                                                                                  | Same                |
| Focus ring    | Teal #0f766e                                                                                  | Same                |

## Differences that need a decision

1. **Body font.** The web app renders Bai Jamjuree for everything, including
   paragraphs, tables and numbers. Its Tailwind `font-sans` says Montserrat, but the
   `body` rule overrides it; Montserrat appears in 13 places (the login hero). The
   desktop app and DESIGN.md use Inter for body text and Bai Jamjuree for display.
2. **Page title color.** Web page titles are Seal Navy (#2a3063). DESIGN.md reserves
   navy for the seal and sets titles in Ink (#10241b).
3. **Light page background.** Web uses a cool grey gradient (#f1f5f9 to #e5e7eb).
   Desktop uses the pale green Page Wash (#eef5f0 to #f6f8f6).
4. **Buttons.** Web mixes 12px-cornered buttons in sentence case with full pills in
   uppercase tracked text ("OPEN LIVE MAP", segmented filters). DESIGN.md has 12px
   corners and sentence case.

## Web-only patterns to add to DESIGN.md

- **Category accents.** Metrics and charts color each category: red, orange, blue,
  teal and purple dots and icons ("Needs immediate action", "Offline or delayed",
  "Open enterprise requests"). DESIGN.md has only status colors. Web palette also has
  lime #45a549, yellow #ffd200, orange #ff6204, blue #2d5eff, sky #a0bbff, peach
  #f5d2bd.
- **Interaction states** as tokens: hover, selected, active, pressed and disabled
  fills (`--tanaw-interactive-*`), plus success, warning, danger and information
  surfaces. Useful for both apps.
- **Login:** full-bleed photograph of the San Pedro arch with a green grade, white
  sign-in card, gold divider with the flower mark.
- **Map view, work queues, admin tables, detail modals, segmented filters, search
  fields, empty states** (icon tile, title, one-line hint).
- **Charts:** primary #047857, secondary #2563eb, grid, axis, tooltip tokens.

## Technical findings

- The web stylesheet defines `--tanaw-*` variables with the same names as the design
  tokens but different light values (`--tanaw-border`, `--tanaw-surface-inset`,
  `--tanaw-control-hover`, `--tanaw-page-bg-gradient`). It loads after the tokens, so
  its values win today.
- Duplicate palettes: `tgreen-*`, `charcoal-*`, `tblue-*`, `tred`, `tyellow` repeat
  Tailwind or token colors under other names.
- 101 full-pill and 117 12px corners in components; 9 one-off 22px, 5 at 30px, 3 at
  28px and 2 at 40px.

## Decisions (November 17, 2026)

1. **Body font:** Inter for body text in both apps, Bai Jamjuree for the wordmark,
   page titles and section headings. Montserrat is retired.
2. **Page titles:** Ink (#10241b), not navy.
3. **Light page background:** the pale green Page Wash in both apps.
4. **Buttons:** one 12px button in sentence case. Pills only for badges, counters and
   segmented filters (sentence case).

DESIGN.md and `tokens/tanaw.css` now include the web patterns above, the Category
Tones, the Map and Chart Palette, interaction states and status surfaces.
