import { describe, expect, it, vi } from "vitest";
import { runOptimisticRead } from "./optimisticRead";

describe("runOptimisticRead", () => {
  it("restores the snapshot and reconciles after a failed mutation", async () => {
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const onSettled = vi.fn();

    await runOptimisticRead({
      request: () => Promise.reject(new Error("offline")),
      onSuccess,
      onFailure,
      onSettled,
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
