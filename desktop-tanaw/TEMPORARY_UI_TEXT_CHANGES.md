# Temporary UI Text Changes

Created: 2026-06-23

These desktop app text changes are temporary. When this temporary wording is removed in the future, revert the labels below.

## Active Changes

- `src/features/dashboard/components/HistoricalTrendChart.tsx`
  - Original: `Historical Visitor Trends`
  - Temporary: `Local Metrics Trend`
- `src/features/camera/components/CameraMonitoringPanel.tsx`
  - Original idle button label: `Start`
  - Temporary idle button label: `Star Processing`
  - Keep the loading label `Starting...` unchanged.

## Revert Instructions

1. Change the dashboard chart heading back to `Historical Visitor Trends`.
2. Change the camera start processing button idle label back to `Start`.
3. Run the desktop app checks from `desktop-tanaw`:

```bash
npm run lint
npm run type
```
