import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentMessageBus } from "../src/communication/message-bus.js";
import type { AgentMessage } from "../src/communication/message-bus.js";

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    type: "message",
    timestamp: new Date().toISOString(),
    from: "cto",
    to: "security-auditor",
    payload: "Review this architecture",
    ...overrides,
  };
}

describe("AgentMessageBus", () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
  });

  // ── Happy path ──

  it("should deliver a message to a subscriber", () => {
    const handler = vi.fn();
    bus.subscribe("security-auditor", handler);
    const msg = makeMessage();
    bus.send(msg);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(msg);
  });

  it("should deliver to multiple subscribers on the same role", () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe("security-auditor", h1);
    bus.subscribe("security-auditor", h2);
    bus.send(makeMessage());
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("should not deliver to subscribers of a different role", () => {
    const handler = vi.fn();
    bus.subscribe("pm", handler);
    bus.send(makeMessage({ to: "security-auditor" }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("should silently drop messages when no subscribers exist", () => {
    expect(() => bus.send(makeMessage({ to: "nonexistent" as any }))).not.toThrow();
  });

  it("should unsubscribe correctly", () => {
    const handler = vi.fn();
    const unsub = bus.subscribe("security-auditor", handler);
    unsub();
    bus.send(makeMessage());
    expect(handler).not.toHaveBeenCalled();
  });

  it("should handle multiple sends in order", () => {
    const received: string[] = [];
    bus.subscribe("security-auditor", (msg) => received.push(msg.payload));
    bus.send(makeMessage({ payload: "first" }));
    bus.send(makeMessage({ payload: "second" }));
    bus.send(makeMessage({ payload: "third" }));
    expect(received).toEqual(["first", "second", "third"]);
  });

  // ── Error isolation ──

  it("should not let a throwing subscriber prevent other subscribers from receiving", () => {
    const goodHandler = vi.fn();
    bus.subscribe("security-auditor", () => {
      throw new Error("subscriber crash");
    });
    bus.subscribe("security-auditor", goodHandler);

    // Should not throw — the error is caught internally
    expect(() => bus.send(makeMessage())).not.toThrow();
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it("should not let a throwing subscriber prevent subsequent sends", () => {
    const handler = vi.fn();
    bus.subscribe("security-auditor", handler);
    bus.subscribe("security-auditor", () => {
      throw new Error("transient error");
    });

    bus.send(makeMessage({ payload: "msg1" }));
    bus.send(makeMessage({ payload: "msg2" }));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("should handle unsubscribe during send iteration without crashing", () => {
    // This tests that Set iteration is safe even if unsubscribe is called mid-iteration.
    // In practice, the unsubscribe function captures the Set reference at subscribe time.
    const handler = vi.fn();
    const unsub = bus.subscribe("security-auditor", (msg) => {
      handler(msg);
      // Unsubscribe during iteration — should not crash
      unsub();
    });

    bus.send(makeMessage({ payload: "first" }));
    expect(handler).toHaveBeenCalledTimes(1);

    // After unsubscribe, no more deliveries
    bus.send(makeMessage({ payload: "second" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should clean up empty subscriber sets after unsubscribe", () => {
    // We can't directly inspect the internal map, but we can verify
    // that unsubscribe + resubscribe works correctly
    const handler1 = vi.fn();
    const unsub = bus.subscribe("security-auditor", handler1);
    unsub();

    const handler2 = vi.fn();
    bus.subscribe("security-auditor", handler2);
    bus.send(makeMessage());
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});
