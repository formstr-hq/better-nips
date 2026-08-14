import type { Event } from "nostr-tools";

export interface InitialNipData {
  coordinate: string;
  canonicalId: string;
  event: Event;
}
