import { useEffect, useMemo } from "react";
import type { Event, Filter } from "nostr-tools";
import { useObserve } from "./useObserve";
import { useGossip } from "./useGossip";
import {
  KIND_APPROVAL,
  KIND_DELETE,
  KIND_NIP,
  LABEL_APPROVE,
  LABEL_DISAPPROVE,
  LABEL_NAMESPACE,
} from "../nostr/constants";
import { approvalTarget, parseNip, type Nip } from "../nostr/nips";
import { decodeNipAddress } from "../nostr/coordinates";
import type { InitialNipData } from "../nostr/initialNip";

export interface LoadedNip {
  nip: Nip | null;
  /** Distinct approver pubkeys across the network (works logged-out). */
  approvers: Set<string>;
  /** Distinct disapprover pubkeys across the network (NIP-32 "disapprove"). */
  disapprovers: Set<string>;
  /** True once the NIP query has reached EOSE (so "not found" is meaningful). */
  ready: boolean;
}

interface Coord {
  kind: number;
  pubkey: string;
  identifier: string;
}

function newer(left: Event, right: Event): Event {
  if (left.created_at !== right.created_at) {
    return left.created_at > right.created_at ? left : right;
  }
  return left.id < right.id ? left : right;
}

/**
 * Resolve a single NIP from a shareable address (naddr or raw coordinate),
 * for the standalone NIP screen. Observes the addressable event plus every
 * NIP-32 approval pointing at it — so a cold-loaded shared link still shows a
 * meaningful approval count, even when the visitor isn't logged in.
 */
export function useNipByAddress(
  id: string,
  networkAuthors: string[] = [],
  initialNip?: InitialNipData,
): LoadedNip & { coord: Coord | null } {
  const address = useMemo(() => decodeNipAddress(id), [id]);
  const coord = useMemo<Coord | null>(
    () =>
      address
        ? { kind: address.kind, pubkey: address.pubkey, identifier: address.identifier }
        : null,
    [address],
  );

  useEffect(() => {
    if (!address) return;
    void fetch("/api/index-nip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coordinate: address.coordinate }),
      keepalive: true,
    }).catch(() => {});
  }, [address]);

  // Pull the NIP author's relays into the gossip pool so a cold shared link
  // resolves even when the NIP lives off your own relays.
  useGossip(useMemo(() => (coord ? [coord.pubkey] : []), [coord]));

  const nipFilters: Filter[] | null =
    coord && coord.kind === KIND_NIP
      ? [
          {
            kinds: [coord.kind],
            authors: [coord.pubkey],
            "#d": [coord.identifier],
          },
        ]
      : null;
  const { events: nipEvents, eose } = useObserve(nipFilters);

  const coordinate = coord
    ? `${coord.kind}:${coord.pubkey}:${coord.identifier}`
    : "";

  // Two approval queries, merged: address-scoped (global total, off your own
  // relays) + author-scoped over your network (outbox-routed to the approvers'
  // relays, so a follow's approval that lives off your relays still shows up).
  const addrFilters: Filter[] | null = coordinate
    ? [{ kinds: [KIND_APPROVAL], "#a": [coordinate], "#L": [LABEL_NAMESPACE], limit: 500 }]
    : null;
  const { events: addrApprovals } = useObserve(addrFilters);

  const networkFilters: Filter[] | null =
    coordinate && networkAuthors.length > 0
      ? [
          {
            kinds: [KIND_APPROVAL],
            "#a": [coordinate],
            "#L": [LABEL_NAMESPACE],
            authors: networkAuthors,
            limit: 500,
          },
        ]
      : null;
  const { events: networkApprovals } = useObserve(networkFilters);

  const candidateEvents = useMemo(() => {
    const initial = initialNip?.coordinate === coordinate ? initialNip.event : null;
    return initial ? [initial, ...nipEvents] : nipEvents;
  }, [coordinate, initialNip, nipEvents]);
  const currentEvent = useMemo(
    () =>
      candidateEvents.reduce<Event | null>(
      (winner, event) => (winner ? newer(winner, event) : event),
        null,
      ),
    [candidateEvents],
  );
  const deletionFilters: Filter[] | null =
    coord && coordinate
      ? [
          { kinds: [KIND_DELETE], authors: [coord.pubkey], "#a": [coordinate] },
          ...(candidateEvents.length > 0
            ? [
                {
                  kinds: [KIND_DELETE],
                  authors: [coord.pubkey],
                  "#e": candidateEvents.map((event) => event.id),
                },
              ]
            : []),
        ]
      : null;
  const { events: deletions } = useObserve(deletionFilters);
  const nip = useMemo(() => {
    if (!currentEvent) return null;
    const deleted = deletions.some(
      (event) =>
        event.pubkey === currentEvent.pubkey &&
        (event.tags.some((tag) => tag[0] === "e" && tag[1] === currentEvent.id) ||
          (event.created_at >= currentEvent.created_at &&
            event.tags.some((tag) => tag[0] === "a" && tag[1] === coordinate))),
    );
    return deleted ? null : parseNip(currentEvent);
  }, [coordinate, currentEvent, deletions]);

  const { approvers, disapprovers } = useMemo(() => {
    const approvers = new Set<string>();
    const disapprovers = new Set<string>();
    for (const e of [...addrApprovals, ...networkApprovals]) {
      if (approvalTarget(e) !== coordinate) continue;
      if (e.tags.some((t) => t[0] === "l" && t[1] === LABEL_APPROVE)) {
        approvers.add(e.pubkey);
      } else if (e.tags.some((t) => t[0] === "l" && t[1] === LABEL_DISAPPROVE)) {
        disapprovers.add(e.pubkey);
      }
    }
    return { approvers, disapprovers };
  }, [addrApprovals, networkApprovals, coordinate]);

  return { nip, approvers, disapprovers, ready: eose || !!nip, coord };
}
