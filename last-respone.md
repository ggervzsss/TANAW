Yes. Based on the current implementation, the lag is very explainable, especially on auth pages. The biggest wins are not business-logic changes; they are rendering, asset, and polling changes.

**Main Findings**

1. Auth pages are repaint-heavy.
   [LoginPage.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/features/login/components/LoginPage.tsx:670) and [ChangePasswordPage.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/features/login/components/ChangePasswordPage.tsx:125) layer full-screen images, gradient overlays, edge blur, cursor glow, particles, backdrop blur, large shadows, and Motion entrance animations.

2. The cursor-follow glow is likely a major hotspot.
   [use-auth-stage-glow.ts](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/features/login/hooks/use-auth-stage-glow.ts:32) updates CSS variables on `requestAnimationFrame` during pointer movement. Those variables drive a large radial glow in [index.css](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/index.css:613). Even though it is throttled to one update per frame, moving a large blended/gradient layer can still force expensive paint work.

3. The auth CSS uses several expensive effects together.
   Examples: image masks and filters at [index.css](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/index.css:171), large inset shadows at [index.css](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/index.css:220), animated particles/glow/shimmer at [index.css](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/index.css:613), and backdrop blur on controls at [index.css](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/index.css:465).

4. Linux currently disables Chromium hardware acceleration.
   [electron/main.ts](/home/ggervzsss/Projects/TANAW/desktop-tanaw/electron/main.ts:57) calls `app.disableHardwareAcceleration()`. If the lag is being observed on Linux, this is probably one of the largest causes because all those auth visual effects become much more CPU-bound.

5. Some images are much larger than needed.
   The auth day image is `4000x3000` and 4 MB. The topbar image is `4608x3456` and 6 MB. Those should be resized/compressed into app-sized WebP/AVIF assets.

6. Initial auth load likely pays for the whole app bundle.
   [AppRouter.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/app/router/AppRouter.tsx:3) statically imports `LoginPage`, `ChangePasswordPage`, and `EnterpriseShell`; then [EnterpriseShell.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/app/layouts/EnterpriseShell.tsx:4) statically imports dashboard, camera, reports, tickets, simulation, etc. That means login startup can pay parsing/initialization cost for pages the user is not using yet.

**Highest-Impact Improvements**

1. Add a “reduced effects” mode for auth pages.
   Disable `.tanaw-stage-particles`, `.tanaw-stage-glow::before`, `.tanaw-stage-glow::after`, shimmer, cursor glow, backdrop blur, and large shadow transitions. Keep the page visually branded, but static. This should be the first auth-page fix.

2. Remove or simplify the pointer-follow glow.
   Replace it with a static background glow, or only enable it on capable devices. If kept, update a small transform-only element instead of repainting gradient variables across a large layer.

3. Re-enable hardware acceleration where safe.
   On Linux, avoid disabling all GPU acceleration just to suppress VAAPI logs. Prefer disabling only problematic video decode features, with an env fallback like `TANAW_DISABLE_GPU=1`.

4. Resize assets.
   Use local optimized images around `1600-1920px` wide for auth/topbar backgrounds, plus a small local San Pedro seal instead of the remote 1280px Wikipedia image used in auth/topbar.

5. Code-split routes.
   Lazy-load `EnterpriseShell` only after authentication, then lazy-load shell pages by active route. This will reduce login startup cost and memory pressure.

6. Reduce background polling/global work.
   [EnterpriseShell.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/app/layouts/EnterpriseShell.tsx:266) polls simulation alert status every 2 seconds globally after ML context is ready. Gate this to active simulation/running simulation, or back it off to 15-30 seconds outside simulation.

7. Dashboard/reports chart and polling tuning.
   Dashboard metrics poll every 5 seconds and charts animate on refresh in [DashboardView.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/features/dashboard/components/DashboardView.tsx:59) and [HistoricalTrendChart.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/features/dashboard/components/HistoricalTrendChart.tsx:119). Disable Recharts animation after initial mount and avoid setting state when fetched data is unchanged.

8. Camera overlay throttling.
   [CameraVideoPreview.tsx](/home/ggervzsss/Projects/TANAW/desktop-tanaw/src/features/camera/components/CameraVideoPreview.tsx:96) renders detection boxes as DOM on every live update. For weaker devices, throttle overlay updates to 5-10 FPS or draw detections to a canvas.

My recommended first implementation pass would be: reduced auth effects, optimized images, Linux hardware acceleration change, and route-level lazy loading. Those should noticeably reduce the “heavy” feel without changing workflows.