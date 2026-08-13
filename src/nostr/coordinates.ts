import { decode, naddrEncode } from "nostr-tools/nip19";
import { KIND_NIP } from "./constants";

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
const MAX_ADDRESS_LENGTH = 4096;

export interface NipAddress {
  kind: typeof KIND_NIP;
  pubkey: string;
  identifier: string;
  coordinate: string;
  canonicalId: string;
}

export function canonicalNaddr(pubkey: string, identifier: string): string {
  return naddrEncode({ kind: KIND_NIP, pubkey, identifier, relays: [] });
}

export function decodeNipAddress(value: string): NipAddress | null {
  if (!value || value.length > MAX_ADDRESS_LENGTH || value.includes("\0")) return null;

  let pubkey: string;
  let identifier: string;
  if (value.startsWith("naddr1")) {
    try {
      const decoded = decode(value);
      if (decoded.type !== "naddr" || decoded.data.kind !== KIND_NIP) return null;
      pubkey = decoded.data.pubkey;
      identifier = decoded.data.identifier;
    } catch {
      return null;
    }
  } else {
    const match = value.match(/^30817:([0-9a-f]{64}):(.*)$/);
    if (!match) return null;
    pubkey = match[1];
    identifier = match[2];
  }

  if (!HEX_PUBKEY.test(pubkey)) return null;
  return {
    kind: KIND_NIP,
    pubkey,
    identifier,
    coordinate: `${KIND_NIP}:${pubkey}:${identifier}`,
    canonicalId: canonicalNaddr(pubkey, identifier),
  };
}
