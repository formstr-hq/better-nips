import { useEffect, useRef, useState } from "react";
import type { Event, Filter } from "nostr-tools";
import { dedupeKey } from "@formstr/local-relay";
import { dataLayer, onWarm } from "../nostr/bootstrap";

interface ObserveState {
  events: Event[];
  eose: boolean;
}

/**
 * Declare a standing interest in `filters` and collect matching events,
 * deduplicated (addressable/replaceable collapse to their latest version).
 * Pass `null` to stay idle. The worker owns the network; we only observe.
 */
export function useObserve(
  filters: Filter[] | null,
  options?: { localOnly?: boolean },
): ObserveState {
  const [state, setState] = useState<ObserveState>({ events: [], eose: false });
  // Re-subscribe only when the filter content actually changes.
  const key = filters ? JSON.stringify(filters) : null;
  const localOnly = options?.localOnly ?? false;
  const store = useRef(new Map<string, Event>());

  useEffect(() => {
    store.current = new Map();
    if (!key) {
      setState({ events: [], eose: false });
      return;
    }
    setState({ events: [], eose: false });
    const parsed: Filter[] = JSON.parse(key);

    // Coalesce the event stream: a `limit: 3000` query fires onEvent thousands
    // of times on first load, and one setState per event is one render per
    // event. Batch into a single flush per animation frame instead. EOSE
    // flushes synchronously so `ready` flips without waiting for a frame.
    let frame = 0;
    let eosed = false;
    const flush = () => {
      frame = 0;
      setState({ events: [...store.current.values()], eose: eosed });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const handle = dataLayer.observe(
      parsed,
      {
        onEvent: (e: Event) => {
          const k = dedupeKey(e);
          const prev = store.current.get(k);
          if (!prev || e.created_at > prev.created_at) {
            store.current.set(k, e);
            schedule();
          }
        },
        onEose: () => {
          eosed = true;
          if (frame) cancelAnimationFrame(frame);
          flush();
        },
      },
      { localOnly },
    );
    // If we subscribed during the worker's cold-start window (before its
    // IndexedDB cache hydrated — a silent bulk load that doesn't fan out to
    // open subs), re-issue the REQ once hydration lands so we pick up the
    // cached corpus. `update` replays against the same sub, so events merge
    // into our store without tearing down or flashing the feed empty.
    const offWarm = onWarm(() => handle.update(parsed));
    return () => {
      if (frame) cancelAnimationFrame(frame);
      offWarm();
      handle.unobserve();
    };
  }, [key, localOnly]);

  return state;
}
