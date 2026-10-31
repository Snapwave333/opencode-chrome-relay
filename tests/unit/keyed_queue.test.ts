import { describe, expect, it } from "vitest";
import { KeyedSerialQueue } from "../../apps/chrome-extension/src/background/keyed_queue.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("KeyedSerialQueue", () => {
  it("runs tasks for the same key strictly in submission order", async () => {
    const queue = new KeyedSerialQueue();
    const order: string[] = [];
    const gate = deferred();

    const first = queue.run("tab:1", async () => {
      order.push("first:start");
      await gate.promise;
      order.push("first:end");
    });
    const second = queue.run("tab:1", async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("runs different keys concurrently", async () => {
    const queue = new KeyedSerialQueue();
    const gate = deferred();
    const started: string[] = [];

    const a = queue.run("tab:1", async () => {
      started.push("a");
      await gate.promise;
    });
    const b = queue.run("tab:2", async () => {
      started.push("b");
    });

    await b;
    expect(started).toEqual(["a", "b"]);
    gate.resolve();
    await a;
  });

  it("keeps draining after a task rejects and propagates the rejection to its caller", async () => {
    const queue = new KeyedSerialQueue();
    const failing = queue.run("tab:1", async () => {
      throw new Error("boom");
    });
    const next = queue.run("tab:1", async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });

  it("forgets idle keys", async () => {
    const queue = new KeyedSerialQueue();
    await queue.run("tab:1", async () => undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(queue.activeKeys).toBe(0);
  });
});
