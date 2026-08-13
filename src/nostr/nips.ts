import type { Event } from "nostr-tools";
import { KIND_NIP } from "./constants";
import { canonicalNaddr } from "./coordinates";

export interface NipKind {
  kind: string;
  name: string;
}

/** A parsed kind-30817 community NIP. */
export interface Nip {
  id: string;
  pubkey: string;
  /** d-tag identifier. */
  d: string;
  /** Addressable coordinate `30817:<pubkey>:<d>` — the approval target. */
  address: string;
  title: string;
  summary: string;
  kinds: NipKind[];
  content: string;
  createdAt: number;
}

function tagValue(e: Event, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1];
}

/** Build the `a` coordinate for an addressable event. */
export function addressOf(e: Event): string {
  return `${e.kind}:${e.pubkey}:${tagValue(e, "d") ?? ""}`;
}

/** Shareable naddr (NIP-19) for a parsed NIP — the id in its screen's URL. */
export function naddrOf(nip: { pubkey: string; d: string }): string {
  try {
    return canonicalNaddr(nip.pubkey, nip.d);
  } catch {
    return `${KIND_NIP}:${nip.pubkey}:${nip.d}`;
  }
}

/** Parse a kind-30817 event into a Nip, or null if it isn't one. */
export function parseNip(e: Event): Nip | null {
  if (e.kind !== KIND_NIP) return null;
  const d = tagValue(e, "d") ?? "";
  const kinds: NipKind[] = e.tags
    .filter((t) => t[0] === "k" && t[1])
    .map((t) => ({ kind: t[1], name: t[2] ?? "" }));
  const title = tagValue(e, "title")?.trim() || d || "Untitled NIP";
  // First non-empty markdown line, minus a leading heading marker.
  const summary =
    (e.content.split("\n").find((l) => l.trim().length > 0) ?? "")
      .replace(/^#+\s*/, "")
      .slice(0, 200);
  return {
    id: e.id,
    pubkey: e.pubkey,
    d,
    address: `${KIND_NIP}:${e.pubkey}:${d}`,
    title,
    summary,
    kinds,
    content: e.content,
    createdAt: e.created_at,
  };
}

/** The `a` coordinate an approval (kind-1985 label) points at. */
export function approvalTarget(e: Event): string | undefined {
  return e.tags.find((t) => t[0] === "a")?.[1];
}

/**
 * Turn a `30817:<pubkey>:<d>` address coordinate into a shareable naddr — the
 * id notifications link to. The d-tag may itself contain colons, so everything
 * after the second colon is the identifier.
 */
export function addressToNaddr(address: string): string {
  const [, pubkey, ...rest] = address.split(":");
  return naddrOf({ pubkey: pubkey ?? "", d: rest.join(":") });
}
