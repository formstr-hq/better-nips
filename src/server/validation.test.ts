import { finalizeEvent, generateSecretKey, type EventTemplate } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { parseVerifiedDeletion, parseVerifiedNip } from "./validation";

function sign(template: EventTemplate) {
  return finalizeEvent(template, generateSecretKey());
}

describe("server event validation", () => {
  it("accepts a signed kind 30817 event and derives its fields", () => {
    const event = sign({
      kind: 30817,
      created_at: 10,
      tags: [["d", "draft"], ["title", "Draft NIP"], ["k", "42", "example"]],
      content: "# Summary\n\nBody",
    });
    expect(parseVerifiedNip(event)).toMatchObject({
      title: "Draft NIP",
      summary: "Summary",
      identifier: "draft",
      definedKinds: [{ kind: 42, name: "example" }],
    });
  });

  it("falls back to the identifier when title is absent", () => {
    const event = sign({ kind: 30817, created_at: 10, tags: [["d", "draft"]], content: "" });
    expect(parseVerifiedNip(event)?.title).toBe("draft");
  });

  it("rejects a modified signature payload", () => {
    const event = sign({ kind: 30817, created_at: 10, tags: [["d", "draft"]], content: "" });
    expect(parseVerifiedNip({ ...event, content: "tampered" })).toBeNull();
  });

  it("rejects timestamps beyond the allowed future skew", () => {
    const event = sign({
      kind: 30817,
      created_at: Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60,
      tags: [["d", "future"]],
      content: "",
    });
    expect(parseVerifiedNip(event)).toBeNull();
  });

  it("parses event and coordinate deletion targets", () => {
    const key = generateSecretKey();
    const nip = finalizeEvent(
      { kind: 30817, created_at: 10, tags: [["d", "draft"]], content: "" },
      key,
    );
    const coordinate = `30817:${nip.pubkey}:draft`;
    const deletion = finalizeEvent(
      { kind: 5, created_at: 11, tags: [["e", nip.id], ["a", coordinate]], content: "" },
      key,
    );
    expect(parseVerifiedDeletion(deletion)?.references).toEqual([
      { type: "event", value: nip.id },
      { type: "coordinate", value: coordinate },
    ]);
  });
});
