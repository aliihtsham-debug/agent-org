import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentEventEmitter } from "../src/observability/events.js";
import type { AgentEvent } from "../src/observability/events.js";

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    type: "spawn",
    timestamp: new Date().toISOString(),
    role: "cto",
    summary: "Test event",
    ...overrides,
  };
}

describe("AgentEventEmitter", () => {
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
  });

  // ── Happy path ──

  it("should deliver an event to a subscriber", () => {
    const handler = vi.fn();
    emitter.subscribe(handler);
    emitter.emit(makeEvent());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should deliver to multiple subscribers", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    emitter.subscribe(h1);
    emitter.subscribe(h2);
    emitter.emit(makeEvent());
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("should deliver all event types", () => {
    const handler = vi.fn();
    emitter.subscribe(handler);
    const types = ["spawn", "complete", "fail", "retry", "info", "gate", "artifact", "review", "refine"] as const;
    for (const type of types) {
      emitter.emit(makeEvent({ type }));
    }
    expect(handler).toHaveBeenCalledTimes(types.length);
  });

  it("should unsubscribe correctly", () => {
    const handler = vi.fn();
    const unsub = emitter.subscribe(handler);
    unsub();
    emitter.emit(makeEvent());
    expect(handler).not.toHaveBeenCalled();
  });

  it("should emit events synchronously", () => {
    let count = 0;
    emitter.subscribe(() => { count++; });
    emitter.subscribe(() => { count++; });
    emitter.subscribe(() => { count++; });
    emitter.emit(makeEvent());
    // All handlers should have run synchronously
    expect(count).toBe(3);
  });

  // ── Error isolation ──

  it("should not let a throwing subscriber prevent other subscribers from receiving", () => {
    const goodHandler = vi.fn();
    emitter.subscribe(() => {
      throw new Error("subscriber crash");
    });
    emitter.subscribe(goodHandler);

    expect(() => emitter.emit(makeEvent())).not.toThrow();
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it("should continue emitting after a subscriber throws", () => {
    const handler = vi.fn();
    emitter.subscribe(() => {
      throw new Error("transient");
    });
    emitter.subscribe(handler);

    emitter.emit(makeEvent());
    emitter.emit(makeEvent());

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should handle nested subscribe/unsubscribe during emit", () => {
    const handler = vi.fn();
    emitter.subscribe((event) => {
      handler(event);
      // Subscribe a new handler during iteration
      emitter.subscribe(() => {});
    });

    emitter.emit(makeEvent());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should handle unsubscribe during emit iteration without crashing", () => {
    const handler = vi.fn();
    const unsub = emitter.subscribe((event) => {
      handler(event);
      unsub(); // Unsubscribe during iteration
    });

    emitter.emit(makeEvent());
    expect(handler).toHaveBeenCalledTimes(1);

    // Second emit should not deliver to the unsubscribed handler
    emitter.emit(makeEvent());
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should not throw when emitting with no subscribers", () => {
    expect(() => emitter.emit(makeEvent())).not.toThrow();
  });
});
