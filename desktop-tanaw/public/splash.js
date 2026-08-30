(() => {
  const root = document.documentElement;
  const minimumDurationMs = 10_000;
  const maximumWaitingProgress = 97.5;
  const finishingDurationMs = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 180 : 520;
  let startedAt = null;
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
    if (startedAt === null) {
      requestAnimationFrame(frame);
      return;
    }

    const elapsed = now - startedAt;
    if (!completionRequested) {
      const ratio = Math.min(1, elapsed / minimumDurationMs);
      const easedWaiting = ratio * ratio * (3 - 2 * ratio);
      setProgress(maximumWaitingProgress * easedWaiting);
      requestAnimationFrame(frame);
      return;
    }

    if (elapsed < minimumDurationMs) {
      const ratio = elapsed / minimumDurationMs;
      const easedReady = ratio * ratio * (3 - 2 * ratio);
      setProgress(100 * easedReady);
      requestAnimationFrame(frame);
      return;
    }

    if (currentProgress >= 99.9) {
      setProgress(100);
      resolveCompletion?.();
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
    start() {
      if (startedAt === null) startedAt = performance.now();
    },
    ready() {
      if (startedAt === null) startedAt = performance.now();
      completionRequested = true;
    },
    complete() {
      if (startedAt === null) startedAt = performance.now() - minimumDurationMs;
      completionRequested = true;
      return completion;
    },
  };

  requestAnimationFrame(frame);
})();
