The dark appearance now uses a single semantic palette in `src/theme-tokens.css`, component roles in `src/theme.css`, and a lower-priority adapter for existing utility classes in `src/theme-utilities.css`. Existing layout and typography remain in their original stylesheets.

The previous stagger came from mixed transition properties/timings, non-interpolating gradients and images, inherited-color transition chains, and theme-sensitive header rendering. Broad `!important` utility rules and independently loaded page palettes also overrode specific controls. The legacy dark palettes were removed from the page stylesheets; Camera and Reports styles now load once with the entry stylesheet. Light utility overrides explicitly apply only to Light Mode.

Theme changes use one 220ms root View Transition. The root class, header subscription, color scheme and saved preference commit together after the old snapshot. Component transitions are suppressed during capture and immediately restored afterwards. Existing hover, press, sidebar, modal and chart motion is retained. Pages and camera previews are not remounted. Rapid toggles cancel obsolete snapshots. Reduced motion, unavailable APIs and snapshot errors use an atomic update with no staggered color animation.

The palette distinguishes canvas, low surfaces, cards, raised popups, inset fields, decorative separators, functional outlines, focus indicators, accents and paired status colors. Decorative card strokes are transparent or quiet; field underlines and focus indicators use separate higher-contrast roles. The official DOT document stays white.

The design follows:

- [Material 3 color roles](https://m3.material.io/styles/color/overview) and Google's [tonal elevation guidance](https://developer.android.com/develop/ui/compose/designsystems/material3#elevation): increasing surface tone communicates elevation, with restrained shadows.
- [Apple Dark Mode guidance](https://developer.apple.com/design/human-interface-guidelines/dark-mode): semantic colors, readable foregrounds and distinct base/elevated surfaces.
- [WCAG 2.2 contrast requirements](https://www.w3.org/TR/WCAG22/#contrast-minimum): at least 4.5:1 for ordinary text and 3:1 for large text; [non-text contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast) informs functional control/focus colors.
- MDN's [CSS transition guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Transitions/Using) and [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition): one snapshot/compositor timeline avoids separate property timelines, including gradients and images.

Verification uses the actual Electron renderer with an isolated local service fixture, plus browser coverage with mock mode enabled and disabled. The theme test records rendered solid-background text contrast, first-committed versus settled component colors, click-to-commit timing, and the single 220ms animation. It also checks Light Mode geometry/type, all five Camera Settings sections, automatic report filters, view/download behavior, popup dismissal and modal focus restoration. Disabled controls, collapsed content, gradients and the official document are excluded from the automated text-contrast sample; gradients and document appearance receive separate visual checks. This is targeted UI verification, not a claim of complete WCAG conformance.

Generated screenshots and JSON measurements are in `test-results/theme-desktop-final/` and `test-results/theme-design-mock/`. The earlier native screenshots are retained in `test-results/theme-before/` for visual comparison. Live RTSP hardware and production backend/database services are not exercised by these fixtures. No real or mock product data, camera counting logic, reporting logic or backend APIs were changed.

The recorded Electron pass checked 1918x980, 1440x1024 and 1100x760 windows in both appearances. Five recorded transitions committed in 24-57ms and each used one 220ms dissolve; sampled colors at commit matched the settled colors exactly. Across 298 rendered text samples, the lowest measured ratio was 5.88:1. These figures describe the isolated test run, not a guarantee for every device, dataset or UI state.

The functional input-outline role measures 4.09:1 against the field surface (3.80:1 against card surfaces), and the focus role measures 8.69:1 against card surfaces. A pixel comparison of the Light Mode Add Camera modal interior against the saved pre-refactor screenshot found no changed pixels in the measured 996x784 region.

Visual review files:

- [Camera Settings before](test-results/theme-before/dark-mode-desktop-dark-the-10374-t-filtering-preserve-layout/dark-camera-settings.png)
- [Camera Settings after](test-results/theme-desktop-final/dark-mode-desktop-dark-the-10374-t-filtering-preserve-layout/dark-Camera-Settings-1918.png)
- [Reports after](test-results/theme-desktop-final/dark-mode-desktop-dark-the-10374-t-filtering-preserve-layout/dark-create-reports.png)
- [Dashboard with mock charts](test-results/theme-design-mock/dark-mode-dark-palette-imm-6cc33-tic-combined-report-filters/dark-dashboard.png)
