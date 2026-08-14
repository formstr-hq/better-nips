import { describe, expect, it } from "vitest";
import { canonicalNaddr, decodeNipAddress } from "./coordinates";

const PUBKEY = "ab".repeat(32);

describe("NIP addresses", () => {
  it("round-trips a canonical naddr", () => {
    const id = canonicalNaddr(PUBKEY, "draft:one");
    expect(decodeNipAddress(id)).toMatchObject({
      pubkey: PUBKEY,
      identifier: "draft:one",
      coordinate: `30817:${PUBKEY}:draft:one`,
      canonicalId: id,
    });
  });

  it("preserves colons in raw coordinate identifiers", () => {
    expect(decodeNipAddress(`30817:${PUBKEY}:draft:one`)?.identifier).toBe("draft:one");
  });

  it("supports the empty identifier used by addressable events", () => {
    const id = canonicalNaddr(PUBKEY, "");
    expect(decodeNipAddress(id)?.coordinate).toBe(`30817:${PUBKEY}:`);
    expect(decodeNipAddress(`30817:${PUBKEY}:`)?.identifier).toBe("");
  });

  it("rejects wrong kinds and malformed keys", () => {
    expect(decodeNipAddress(`30023:${PUBKEY}:draft`)).toBeNull();
    expect(decodeNipAddress("30817:not-a-key:draft")).toBeNull();
  });
});
