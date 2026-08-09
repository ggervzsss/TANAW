import { describe, expect, it } from "vitest";

import { SerializedOperationQueue } from "./serialized-operation-queue";

describe("SerializedOperationQueue", () => {
  it("never overlaps lifecycle operations", async () => {
    const queue = new SerializedOperationQueue();
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push("first:start");
      await firstBlocked;
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("continues after a failed operation", async () => {
    const queue = new SerializedOperationQueue();

    await expect(
      queue.run(async () => {
        throw new Error("failed restart");
      }),
    ).rejects.toThrow("failed restart");

    await expect(queue.run(async () => "recovered")).resolves.toBe("recovered");
  });
});
