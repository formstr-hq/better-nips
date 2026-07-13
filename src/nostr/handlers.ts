import type { Event } from "nostr-tools";
import { KIND_HANDLER_INFO, KIND_HANDLER_RECOMMENDATION } from "./constants";

/** A platform deep-link template from a NIP-89 handler (`web`/`ios`/`android`). */
export interface HandlerLink {
  platform: string;
  /** URL template; may contain a `<bech32>` placeholder for a specific entity. */
  template: string;
  /** Optional entity-type marker (`nevent`, `naddr`, …) — third tag element. */
  entity?: string;
}

/** A parsed kind-31990 handler-information event (an app that opens some kinds). */
export interface Handler {
  id: string;
  pubkey: string;
  /** d-tag identifier. */
  d: string;
  /** Addressable coordinate `31990:<pubkey>:<d>`. */
  address: string;
  name: string;
  picture?: string;
  about?: string;
  /** Event kinds this handler declares it can open (from `k` tags). */
  kinds: Set<string>;
  links: HandlerLink[];
  createdAt: number;
}

/** A parsed kind-31989 recommendation — one user's handlers for one kind. */
export interface Recommendation {
  pubkey: string;
  /** The kind this recommendation is for (the d-tag). */
  kind: string;
  /** Handler coordinates (`31990:<pubkey>:<d>`) this recommendation points at. */
  handlers: string[];
  /** The source event — kept so a recommendation can be merged into / retracted. */
  event: Event;
}

function tagValue(e: Event, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1];
}

/** Parse a kind-31990 event into a Handler, or null if it isn't one. */
export function parseHandler(e: Event): Handler | null {
  if (e.kind !== KIND_HANDLER_INFO) return null;
  const d = tagValue(e, "d") ?? "";
  let meta: { name?: string; display_name?: string; picture?: string; about?: string } = {};
  try {
    meta = JSON.parse(e.content || "{}");
  } catch {
    // A handler may carry a bare metadata blob; a malformed one just has no name.
  }
  const kinds = new Set(
    e.tags.filter((t) => t[0] === "k" && t[1]).map((t) => t[1]),
  );
  const links: HandlerLink[] = e.tags
    .filter((t) => ["web", "ios", "android"].includes(t[0]) && t[1])
    .map((t) => ({ platform: t[0], template: t[1], entity: t[2] }));
  return {
    id: e.id,
    pubkey: e.pubkey,
    d,
    address: `${KIND_HANDLER_INFO}:${e.pubkey}:${d}`,
    name: meta.display_name || meta.name || "",
    picture: meta.picture,
    about: meta.about,
    kinds,
    links,
    createdAt: e.created_at,
  };
}

/** Parse a kind-31989 event into a Recommendation, or null if it isn't one. */
export function parseRecommendation(e: Event): Recommendation | null {
  if (e.kind !== KIND_HANDLER_RECOMMENDATION) return null;
  const kind = tagValue(e, "d");
  if (!kind) return null;
  const handlers = e.tags
    .filter((t) => t[0] === "a" && t[1]?.startsWith(`${KIND_HANDLER_INFO}:`))
    .map((t) => t[1]);
  return { pubkey: e.pubkey, kind, handlers, event: e };
}

/**
 * The best outbound URL for a handler. Prefers a `web` template with no
 * `<bech32>` placeholder (the app's own root), since "apps related to this NIP"
 * links to the app, not to a specific entity. Returns undefined when the only
 * web link is entity-scoped (nothing sensible to open without a target).
 */
export function handlerWebUrl(h: Handler): string | undefined {
  const webs = h.links.filter((l) => l.platform === "web");
  const root = webs.find((l) => !l.template.includes("<bech32>"));
  return root?.template;
}
