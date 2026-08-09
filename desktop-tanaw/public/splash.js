(() => {
  const root = document.documentElement;
  const startedAt = performance.now();
  const minimumDurationMs = 10_000;
  const maximumWaitingProgress = 94;
  const finishingDurationMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 180 : 520;
  let completionRequested = false;
  let finishingStartedAt = 0;
  let currentProgress = 0;
  let resolveCompletion;

  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });

  const setProgress = (progress) => {
    currentProgress = Math.max(currentProgress, Math.min(100, progress));
    root.style.setProperty("--tanaw-boot-progress", currentProgress.toFixed(3));
  };

  const frame = (now) => {
    const elapsed = now - startedAt;
    if (!completionRequested || elapsed < minimumDurationMs) {
      const ratio = Math.min(1, elapsed / minimumDurationMs);
      setProgress(maximumWaitingProgress * (1 - Math.pow(1 - ratio, 2.15)));
      requestAnimationFrame(frame);
      return;
    }

    if (!finishingStartedAt) {
      finishingStartedAt = now;
      root.dataset.bootProgressState = "finishing";
    }
    const finishingRatio = Math.min(1, (now - finishingStartedAt) / finishingDurationMs);
    const eased = 1 - Math.pow(1 - finishingRatio, 3);
    setProgress(maximumWaitingProgress + eased * (100 - maximumWaitingProgress));
    if (finishingRatio < 1) {
      requestAnimationFrame(frame);
      return;
    }

    setProgress(100);
    resolveCompletion?.();
  };

  window.tanawSplash = {
    complete() {
      completionRequested = true;
      return completion;
    },
  };

  requestAnimationFrame(frame);
})();
