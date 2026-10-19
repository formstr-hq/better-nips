import { describe, expect, it } from "vitest";
import { applyNip09, latestNip01, parseNipCoordinate } from "./types";

describe("NIP-01 replacement ordering", () => {
  it("selects the newest timestamp", () => {
    expect(
      latestNip01([
        { id: "b", created_at: 10 },
        { id: "a", created_at: 11 },
      ])?.id,
    ).toBe("a");
  });

  it("selects the lowest event id for equal timestamps", () => {
    expect(
      latestNip01([
        { id: "b", created_at: 10 },
        { id: "a", created_at: 10 },
      ])?.id,
    ).toBe("a");
  });
});

describe("coordinate parsing", () => {
  const pubkey = "ab".repeat(32);

  it("accepts an empty identifier but requires a canonical kind", () => {
    expect(parseNipCoordinate(`30817:${pubkey}:`)?.identifier).toBe("");
    expect(parseNipCoordinate(`030817:${pubkey}:draft`)).toBeNull();
    expect(parseNipCoordinate(`3.0817e4:${pubkey}:draft`)).toBeNull();
  });
});

describe("NIP-09 deletion state", () => {
  const coordinate = `30817:${"ab".repeat(32)}:draft`;
  const version = { id: "nip", created_at: 10, pubkey: "ab".repeat(32), coordinate };

  it("applies same-author coordinate deletions through their timestamp", () => {
    const [state] = applyNip09([version], [
      { id: "delete", created_at: 10, pubkey: version.pubkey, targetCoordinate: coordinate },
    ]);
    expect(state.deletedBy).toBe("delete");
  });

  it("does not apply another author's or an older coordinate deletion", () => {
    expect(
      applyNip09([version], [
        { id: "other", created_at: 20, pubkey: "cd".repeat(32), targetCoordinate: coordinate },
        { id: "old", created_at: 9, pubkey: version.pubkey, targetCoordinate: coordinate },
      ])[0].deletedBy,
    ).toBeNull();
  });

  it("allows a later republished version", () => {
    const later = { ...version, id: "later", created_at: 12 };
    const states = applyNip09([version, later], [
      { id: "delete", created_at: 11, pubkey: version.pubkey, targetCoordinate: coordinate },
    ]);
    expect(states.map((state) => state.deletedBy)).toEqual(["delete", null]);
  });
});
