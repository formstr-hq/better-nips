import { z } from "zod";
import ipaddr from "ipaddr.js";

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host.toLowerCase() === "localhost") return true;
  if (!ipaddr.isValid(host)) return false;
  let address = ipaddr.parse(host);
  if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
    address = address.toIPv4Address();
  }
  return address.range() !== "unicast";
}

const relayUrlSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error();
      if (url.username || url.password || url.hash || isPrivateHost(url.hostname)) {
        throw new Error();
      }
      if (process.env.NODE_ENV === "production" && url.protocol !== "wss:") throw new Error();
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return url.href.replace(/\/$/, "");
    } catch {
      context.addIssue({
        code: "custom",
        message: "Relay URL must be a public ws(s) URL (wss in production)",
        input: value,
      });
      return z.NEVER;
    }
  });

export const relayDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/),
  url: relayUrlSchema,
  exact: z.boolean().default(true),
  discovery: z.boolean().default(true),
});

export type RelayDefinition = z.infer<typeof relayDefinitionSchema>;

export const DEFAULT_SERVER_RELAYS: readonly RelayDefinition[] = [
  { key: "damus", url: "wss://relay.damus.io", exact: true, discovery: true },
  { key: "nos-lol", url: "wss://nos.lol", exact: true, discovery: true },
  { key: "primal", url: "wss://relay.primal.net", exact: true, discovery: true },
  { key: "nostr-band", url: "wss://relay.nostr.band", exact: true, discovery: true },
  { key: "ditto", url: "wss://relay.ditto.pub", exact: true, discovery: true },
];

/** Parse a server-provided JSON registry, falling back only when no value exists. */
export function configuredRelayRegistry(raw?: string): RelayDefinition[] {
  const parsed = raw
    ? z.array(relayDefinitionSchema).min(1).max(32).parse(JSON.parse(raw))
    : [...DEFAULT_SERVER_RELAYS];
  const keys = new Set<string>();
  const urls = new Set<string>();
  for (const relay of parsed) {
    if (keys.has(relay.key) || urls.has(relay.url)) {
      throw new Error(`Duplicate relay registry entry: ${relay.key} (${relay.url})`);
    }
    keys.add(relay.key);
    urls.add(relay.url);
  }
  if (!parsed.some((relay) => relay.exact) || !parsed.some((relay) => relay.discovery)) {
    throw new Error("Relay registry requires at least one exact and one discovery relay");
  }
  return parsed;
}
