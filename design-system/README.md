# TANAW design system

One design system for both TANAW apps: the web portal (`frontend-tanaw`) and the
desktop app (`desktop-tanaw`). It holds the tokens, one implementation of every shared
UI component, the documentation and a live Storybook preview.

**The apps never import from this folder.** Each app builds and deploys on its own:
Vercel builds only `frontend-tanaw`, and electron-builder packages only `desktop-tanaw`.
Instead, a sync script copies the code into each app as generated files, and a test in
each app fails if a copy is edited by hand or falls behind. Both apps therefore run the
exact same UI code without being connected.

## What is decided

- **Look:** the desktop app's original visual design (before the neth merge): civic
  green, seal gold, Bai Jamjuree and Inter, white record cards on a pale green page.
- **Layout and UX:** the neth branch's page structure and workflows.
- **Guiding idea:** "The Town Hall Ledger": official, exact and calm, with the counts
  as the content.
- **Case:** sentence case for buttons, badges, filters and headings; uppercase only for
  labels that name a figure or column.

These were chosen on the TANAW Identity Board on November 17, 2026. The full
specification is [DESIGN.md](DESIGN.md).

## Structure

```text
design-system/
├── DESIGN.md                  specification: identity, normative tokens, rules, component specs
├── tokens/tanaw.css           Tailwind v4 tokens, light and dark (source of truth)
├── src/
│   ├── index.ts               everything the apps import
│   ├── components/            primitives (+ *.stories.tsx next to each)
│   ├── patterns/              composites: MetricStrip, PageHeader, PasswordRequirements, TopbarGlassIndicator
│   ├── lib/                   shared helpers: cn, sentence case, focus trap, popup dismissal, motion presets
│   └── styles/components.css  styles Tailwind classes cannot express
├── docs/                      Storybook documentation pages (MDX)
├── fonts/                     Inter and Bai Jamjuree for the preview (SIL OFL)
├── .storybook/                Storybook configuration
├── scripts/
│   ├── sync.mjs               copies tokens and src/ into both apps; --check reports drift
│   └── a11y-sweep.mjs         runs axe on every story in light and dark
└── audits/web-app.md          the web audit behind the November 17 decisions
```

## Components

| Group | Components |
| --- | --- |
| Actions | `Button` (primary, secondary, danger, ghost, link; sm, md, lg; loading), `IconButton` |
| Status | `Badge` (seven tones, dot, sentence case), `StatusDot`, `Alert`, `ProgressBar`, `Spinner`, `Skeleton` |
| Containers | `Card`, `CardHeader`, `CardFooter`, `SectionLabel`, `EmptyState` |
| Forms | `Field`, `Input`, `Textarea`, `SearchField`, `Select`, `Checkbox`, `Switch` |
| Navigation | `Tabs`, `SegmentedControl` |
| Overlays | `Dialog`, `ConfirmDialog`, `ModalPortal`, `Tooltip` |
| Data | `Table` (`TableHead`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell`), `DetailField`, `DetailList`, `ExpandableText`, `Avatar` |
| Patterns | `MetricStrip`, `PageHeader`, `PasswordRequirements`, `PasswordMatchIndicator`, `TopbarLiquidGlass`, `TopbarActiveUnderline` |

Every prop is documented in the source and appears in Storybook's Docs tab.

## Commands

From `design-system/` (run `npm install` once):

| Command | What it does |
| --- | --- |
| `npm run storybook` | Live preview at <http://127.0.0.1:6006> with a Light/Dark toolbar switch |
| `npm run build-storybook` | Static preview in `storybook-static/` |
| `npm run a11y` | axe check of every story in both themes (Storybook must be running) |
| `npm run type` | Type-checks components, stories and docs |
| `npm run sync` | Copies tokens and components into both apps |
| `npm run sync:check` | Exits 1 if any copy is missing, stale or left over |

The sync also runs from the repository root: `node design-system/scripts/sync.mjs`.

## How a change reaches the apps

1. Edit `src/` (or `tokens/tanaw.css` plus the matching value in `DESIGN.md`).
2. Run `node design-system/scripts/sync.mjs`. It writes
   `<app>/src/design-system/**` and `<app>/src/styles/tanaw-tokens.css`, and removes
   copies whose source was deleted.
3. Run each app's fast checks (`npm run type`, `npm run lint`, `npm test`).
4. Commit the source and both copies together.

Each copy starts with a header naming its source and recording its SHA-256.
`tests/unit/configuration/design-system.test.ts` in each app checks every copy against
its header (no hand edits) and against this folder (nothing stale, missing or left
over). Both apps list the copies in `.prettierignore`; they are type-checked and
linted by each app like any other code.

## How the apps use it

Both apps import the shared stylesheet after the tokens in `src/index.css` and import
components from their copy, for example `import { Badge, Button } from "../design-system"`.
Each app's earlier components (`SelectDropdown`, `StatusBadge`, `ModalFrame`,
`UnifiedMetricsHeader`, `InfoTooltip`, `DesignSwitch`, …) are now thin wrappers over the
shared ones, so every existing screen runs the shared code. Shared components are
presentational: sign-in, API calls, Electron bridges and password rules stay in each
app and are passed in.

## Rules

1. **Change the design system here, never in an app.** The app copies are generated.
2. **React 18 and 19.** Components must work on the desktop's React 18 and the web's
   React 19: `forwardRef` for refs, no ref-as-prop, no `use()`. Type-only imports, no
   enums or namespaces, relative imports only.
3. **Every component documents its states** in stories: default, hover, focus, active,
   disabled, loading, error, and dark mode (toolbar).
4. **Role tokens, not raw colours.** No new greens: map any green to a token.
5. **Accessible by default:** `npm run a11y` passes, every control has a label, focus is
   visible, text meets 4.5:1.

## Older values to replace

| Found in the apps | Use instead |
| --- | --- |
| `bg-tanaw-green`, `#055b25` | `bg-tanaw-civic` or `bg-(--tanaw-action)` |
| `#065f46`, `text-emerald-800` for green text | `text-(--tanaw-accent-ink)` |
| `#1b4332` labels | `text-(--tanaw-label)` |
| `--tanaw-green` (#064e2f) | `--tanaw-action` or `--tanaw-accent-ink`, by role |
| neth's `#335d43`, `#325d40`, `#14571f` | `--tanaw-action` / `--tanaw-accent-ink` |
| `#b7952b` gold text | `text-(--tanaw-gold-ink)` |
| 28px card corners, 54px buttons | `rounded-tanaw-lg`, `Button` (42px) |
| Hand-made status pills | `Badge` with a tone |

## Design review screenshots

```bash
cd desktop-tanaw && TANAW_DESIGN_CAPTURE=<folder> npx playwright test open-space unified-reporting -g "design review"
```

```bash
cd frontend-tanaw && TANAW_DESIGN_CAPTURE=<folder> npx playwright test design-screens
```
