import { useCallback, useEffect, useMemo, useState } from "react";
import type { Event, Filter } from "nostr-tools";
import { useObserve } from "./useObserve";
import {
  KIND_APPROVAL,
  KIND_COMMENT,
  LABEL_APPROVE,
  LABEL_DISAPPROVE,
  LABEL_NAMESPACE,
} from "../nostr/constants";
import { approvalTarget } from "../nostr/nips";

export type NotificationType = "comment" | "approval" | "disapproval";

export interface NotificationItem {
  /** The source event id — the stable key and the read/unread unit. */
  id: string;
  type: NotificationType;
  /** Who acted (commenter / approver). */
  pubkey: string;
  createdAt: number;
  /** The `30817:…` address of your NIP they acted on. */
  nipAddress: string;
  /** Comment text (empty for approvals). */
  content: string;
}

export interface Notifications {
  items: NotificationItem[];
  unread: number;
  markAllRead: () => void;
}

/** localStorage key holding the newest-seen timestamp, per account. */
function seenKey(pubkey: string): string {
  return `better-nips:notifs-seen:${pubkey}`;
}

function readSeen(pubkey: string | null): number {
  if (!pubkey) return 0;
  const raw = localStorage.getItem(seenKey(pubkey));
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** The NIP address a comment is rooted at (`A` uppercase, or `a` fallback). */
function commentRoot(e: Event): string | undefined {
  return (
    e.tags.find((t) => t[0] === "A")?.[1] ??
    e.tags.find((t) => t[0] === "a")?.[1]
  );
}

/**
 * Notifications for the logged-in user: comments on their NIPs (or replies to
 * their comments) and approvals / disapprovals of their NIPs. Both are surfaced
 * by the `p`/`P` pubkey tags the events carry — so we never need to know which
 * NIPs are theirs. Read state is a single "newest-seen" timestamp in
 * localStorage; anything newer counts as unread. Sorted newest-first.
 */
export function useNotifications(pubkey: string | null): Notifications {
  // Comments in threads rooted at my NIPs (uppercase `P` = root author) and
  // replies that tag me directly (lowercase `p` = replied-to author).
  const commentFilters: Filter[] | null = pubkey
    ? [
        { kinds: [KIND_COMMENT], "#P": [pubkey], limit: 500 },
        { kinds: [KIND_COMMENT], "#p": [pubkey], limit: 500 },
      ]
    : null;
  const { events: commentEvents } = useObserve(commentFilters);

  // Verdicts on my NIPs — the approval template tags the NIP author with `p`.
  const approvalFilters: Filter[] | null = pubkey
    ? [
        {
          kinds: [KIND_APPROVAL],
          "#p": [pubkey],
          "#L": [LABEL_NAMESPACE],
          limit: 500,
        },
      ]
    : null;
  const { events: approvalEvents } = useObserve(approvalFilters);

  const [seen, setSeen] = useState(() => readSeen(pubkey));
  useEffect(() => setSeen(readSeen(pubkey)), [pubkey]);

  const items = useMemo<NotificationItem[]>(() => {
    if (!pubkey) return [];
    const out: NotificationItem[] = [];

    for (const e of commentEvents) {
      if (e.pubkey === pubkey) continue; // your own comments aren't notifications
      const nipAddress = commentRoot(e);
      if (!nipAddress) continue;
      out.push({
        id: e.id,
        type: "comment",
        pubkey: e.pubkey,
        createdAt: e.created_at,
        nipAddress,
        content: e.content,
      });
    }

    for (const e of approvalEvents) {
      if (e.pubkey === pubkey) continue;
      const isApprove = e.tags.some(
        (t) => t[0] === "l" && t[1] === LABEL_APPROVE,
      );
      const isDisapprove = e.tags.some(
        (t) => t[0] === "l" && t[1] === LABEL_DISAPPROVE,
      );
      if (!isApprove && !isDisapprove) continue;
      const nipAddress = approvalTarget(e);
      if (!nipAddress) continue;
      out.push({
        id: e.id,
        type: isApprove ? "approval" : "disapproval",
        pubkey: e.pubkey,
        createdAt: e.created_at,
        nipAddress,
        content: "",
      });
    }

    // De-dupe (the two comment filters can both match a reply) and sort newest
    // first.
    const byId = new Map<string, NotificationItem>();
    for (const n of out) byId.set(n.id, n);
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [commentEvents, approvalEvents, pubkey]);

  const unread = useMemo(
    () => items.filter((n) => n.createdAt > seen).length,
    [items, seen],
  );

  const markAllRead = useCallback(() => {
    if (!pubkey) return;
    const newest = items[0]?.createdAt ?? Math.floor(Date.now() / 1000);
    localStorage.setItem(seenKey(pubkey), String(newest));
    setSeen(newest);
  }, [pubkey, items]);

  return { items, unread, markAllRead };
}
