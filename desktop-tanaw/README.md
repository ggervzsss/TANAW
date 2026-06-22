# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Simulation Lab

The Simulation Lab is hidden during normal enterprise use. Type `simulation`
anywhere in the desktop application to reveal its temporary main-navigation
item, then open **Simulation Lab** to generate live entry and exit events
without connecting a CCTV camera. Leaving the page hides the navigation item
again, but an active simulation continues inside the local ML service until it
is stopped, completed, or reset.

The simulator writes to the same enterprise-scoped SQLite ledger used by camera
detections, so the desktop dashboard, report draft, cloud telemetry, Admin map,
and alert workflow exercise the normal TANAW data path.

Available controls include scenario presets, venue capacity, starting
occupancy, event rate, duration, alert threshold, pause/resume, manual
entry/exit events, and per-run cleanup. The Fleet Simulation section can also
include other registered enterprises in the Admin map by assigning them normal,
warning, or one-minute threshold-breach lanes. Fleet runs are advanced by the
normal background cloud-sync loop, so they keep sending simulated telemetry
after you navigate away from the hidden lab. Simulated rows remain internally
tagged with their run identifier and can be removed without deleting real
camera events.

## Tailwind canonical-class linting

The normal desktop lint command also scans the renderer source for Tailwind classes that VS Code would report as “can be written as”:

```bash
npm run lint
```

To run only the Tailwind scan or automatically apply its compiler-verified canonical replacements:

```bash
npm run lint:tailwind
npm run lint:tailwind:fix
```

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type aware lint rules:

- Configure the top-level `parserOptions` property like this:

```js
export default {
  // other rules...
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: ["./tsconfig.json", "./tsconfig.node.json"],
    tsconfigRootDir: __dirname,
  },
};
```

- Replace `plugin:@typescript-eslint/recommended` to `plugin:@typescript-eslint/recommended-type-checked` or `plugin:@typescript-eslint/strict-type-checked`
- Optionally add `plugin:@typescript-eslint/stylistic-type-checked`
- Install [eslint-plugin-react](https://github.com/jsx-eslint/eslint-plugin-react) and add `plugin:react/recommended` & `plugin:react/jsx-runtime` to the `extends` list
