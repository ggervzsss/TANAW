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
background. Use it in topbars and sign-in or account verification headers. Each app keeps a local
copy in its assets directory ([web portal](frontend-tanaw/assets/tanaw-logo.png) and
[desktop app](desktop-tanaw/assets/tanaw-logo.png)).

**Type.** Bai Jamjuree (400–700) for the TANAW wordmark, page titles and section headings. Inter
for everything else: body, labels, tables, forms and figures. Both are bundled in each app's
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
- Buttons and badges use sentence case; uppercase tracked labels name figures and columns.
- Every count has a label saying what it counts and, where it matters, when.
- Text meets WCAG AA contrast in both themes; every control has a visible focus state and
  works from the keyboard. Dialogs keep focus inside, close on Escape and return focus.
- Official report forms and their print and PDF output follow the DOT layouts, whatever the
  app's own style.

## What each app decides

Layout, navigation, page structure, spacing scale, density, component shapes and motion are
each app's choice, as long as the identity and rules above hold. Record an app-specific
convention in that app's README or beside the code that uses it, not here.
