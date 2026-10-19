import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredRelayRegistry } from "./relays";

afterEach(() => {
  vi.unstubAllEnvs();
});

function registry(url: string) {
  return JSON.stringify([{ key: "test", url, exact: true, discovery: true }]);
}

describe("server relay registry", () => {
  it("normalizes public relay URLs", () => {
    expect(configuredRelayRegistry(registry("wss://EXAMPLE.com/"))[0].url).toBe(
      "wss://example.com",
    );
  });

  it.each([
    "wss://127.0.0.1",
    "wss://172.16.0.1",
    "wss://192.168.1.1",
    "wss://[::1]",
    "wss://[fc00::1]",
    "wss://[fe80::1]",
    "wss://[::ffff:127.0.0.1]",
  ])("rejects private relay target %s", (url) => {
    expect(() => configuredRelayRegistry(registry(url))).toThrow();
  });

  it("requires TLS in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => configuredRelayRegistry(registry("ws://relay.example.com"))).toThrow();
  });
});
