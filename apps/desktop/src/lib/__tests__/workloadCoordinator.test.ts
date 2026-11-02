import { WorkloadCoordinator } from "@/lib/workloadCoordinator";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("WorkloadCoordinator", () => {
  it("runs work FIFO with no overlapping operations and publishes state transitions", async () => {
    const coordinator = new WorkloadCoordinator();
    const gate = deferred<void>();
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];

    const first = coordinator.run("text", async ({ setProgress }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("first-start");
      setProgress({ current: 1, total: 2, message: "first chunk" });
      await gate.promise;
      active -= 1;
      order.push("first-end");
    });
    const second = coordinator.run("audio", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push("second-start");
      active -= 1;
      order.push("second-end");
    });

    await Promise.resolve();
    expect(coordinator.getSnapshot().map((job) => job.state)).toEqual(["running", "queued"]);
    gate.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second-start", "second-end"]);
    expect(maxActive).toBe(1);
    expect(coordinator.getSnapshot().map((job) => job.state)).toEqual(["completed", "completed"]);
    expect(coordinator.getSnapshot()[0]?.progress).toEqual({
      current: 1,
      total: 2,
      message: "first chunk",
    });
    expect(coordinator.getSnapshot()[0]?.startedAt).toBeDefined();
    expect(coordinator.getSnapshot()[0]?.completedAt).toBeDefined();
  });

  it("cancels a queued job before its operation starts", async () => {
    const coordinator = new WorkloadCoordinator();
    const gate = deferred<void>();
    const first = coordinator.run("text", async () => gate.promise);
    const operation = jest.fn().mockResolvedValue(undefined);
    const second = coordinator.run("audio", operation);
    const secondJob = coordinator.getSnapshot()[1]!;

    expect(coordinator.cancel(secondJob.id)).toBe(true);
    gate.resolve();
    await first;
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()[1]?.state).toBe("cancelled");
  });

  it("serializes streamed output and preserves chunk delivery", async () => {
    const coordinator = new WorkloadCoordinator();
    const gate = deferred<void>();
    const order: string[] = [];
    const first = coordinator.run("text", async () => {
      order.push("first-start");
      await gate.promise;
      order.push("first-end");
    });
    const stream = coordinator.runStream("text", async function* () {
      order.push("stream-start");
      yield "one";
      yield "two";
    });

    const values: string[] = [];
    const consume = (async () => {
      for await (const value of stream) values.push(value);
    })();
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    gate.resolve();
    await Promise.all([first, consume]);

    expect(order).toEqual(["first-start", "first-end", "stream-start"]);
    expect(values).toEqual(["one", "two"]);
    expect(coordinator.getSnapshot().map((job) => job.state)).toEqual([
      "completed",
      "completed",
    ]);
  });

  it("marks failures and retains a readable error", async () => {
    const coordinator = new WorkloadCoordinator();
    await expect(
      coordinator.run("text", async () => {
        throw new Error("provider unavailable");
      })
    ).rejects.toThrow("provider unavailable");

    expect(coordinator.getSnapshot()[0]).toMatchObject({
      state: "failed",
      error: "provider unavailable",
    });
  });
});
