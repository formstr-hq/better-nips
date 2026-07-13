import { useCallback, useMemo, useState } from "react";
import type { EventTemplate, Filter } from "nostr-tools";
import { useObserve } from "./useObserve";
import { dataLayer, signer } from "../nostr/bootstrap";
import {
  CLIENT_NAME,
  KIND_DELETE,
  KIND_HANDLER_INFO,
  KIND_HANDLER_RECOMMENDATION,
  RELAYS,
} from "../nostr/constants";
import { toast } from "../lib/toast";
import {
  parseHandler,
  parseRecommendation,
  type Handler,
  type Recommendation,
} from "../nostr/handlers";

/** An app surfaced for a NIP: a handler plus who (in your network) vouches for it. */
export interface AppEntry {
  handler: Handler;
  /** The NIP's kinds this app relates to (declared by the handler or recommended for). */
  supportedKinds: string[];
  /** Network pubkeys who recommended this app for one of the NIP's kinds. */
  recommenders: Set<string>;
  /** Trust-weighted sort score (follow = 3, web-of-trust = 2, other = 1). */
  score: number;
  /** Whether the logged-in user currently recommends this app. */
  mine: boolean;
}

export interface RegisterInput {
  name: string;
  url: string;
  picture?: string;
  about?: string;
  /** Kinds (subset of the NIP's) the new handler declares support for. */
  kinds: string[];
}

const relayHint = RELAYS[0];

function weightOf(pk: string, follows: Set<string>, wot: Set<string>): number {
  if (follows.has(pk)) return 3;
  if (wot.has(pk)) return 2;
  return 1;
}

/**
 * NIP-89 handlers for a NIP's declared kinds. Discovers apps two ways and merges:
 * handlers that directly declare one of the kinds (`kind:31990` `#k`), and
 * handlers your follows ∪ web-of-trust recommend (`kind:31989` `#d`), whose
 * coordinates are then resolved to their `31990` metadata. Apps your trust graph
 * vouches for sort first, reusing the feed's follow/web-of-trust weighting.
 *
 * Recommending publishes a `kind:31989`: since that event is addressable by kind
 * (its `d`) and can list several handlers, we merge the app into the user's
 * existing recommendation for each kind rather than clobbering it. Registering a
 * new app publishes a `kind:31990` and recommends it in one step.
 */
export function useHandlers(
  kinds: string[],
  follows: string[],
  webOfTrust: Set<string>,
  onNeedsAuth?: () => void,
) {
  const me = signer.getActiveAccount()?.pubkey ?? null;
  const nipKinds = useMemo(() => [...new Set(kinds)], [kinds]);
  const followSet = useMemo(() => new Set(follows), [follows]);
  const networkAuthors = useMemo(
    () => [...new Set([...follows, ...webOfTrust])],
    [follows, webOfTrust],
  );

  // Handlers that directly declare one of the NIP's kinds.
  const handlerFilters: Filter[] | null =
    nipKinds.length > 0
      ? [{ kinds: [KIND_HANDLER_INFO], "#k": nipKinds, limit: 200 }]
      : null;
  const { events: kindHandlers, eose } = useObserve(handlerFilters);

  // Recommendations for these kinds, from your network and from you.
  const recAuthors = useMemo(
    () => [...new Set([...networkAuthors, ...(me ? [me] : [])])],
    [networkAuthors, me],
  );
  const recFilters: Filter[] | null =
    nipKinds.length > 0 && recAuthors.length > 0
      ? [
          {
            kinds: [KIND_HANDLER_RECOMMENDATION],
            authors: recAuthors,
            "#d": nipKinds,
            limit: 500,
          },
        ]
      : null;
  const { events: recEvents } = useObserve(recFilters);

  const recommendations = useMemo(
    () =>
      recEvents
        .map(parseRecommendation)
        .filter((r): r is Recommendation => !!r),
    [recEvents],
  );

  // Resolve any recommended handler we don't already have from the `#k` query.
  const recCoords = useMemo(() => {
    const set = new Set<string>();
    for (const r of recommendations) for (const a of r.handlers) set.add(a);
    return [...set];
  }, [recommendations]);
  const coordFilters: Filter[] | null = useMemo(() => {
    const authors = new Set<string>();
    const ids = new Set<string>();
    for (const a of recCoords) {
      const [, pubkey, ...rest] = a.split(":");
      if (pubkey) authors.add(pubkey);
      if (rest.length) ids.add(rest.join(":"));
    }
    return authors.size > 0
      ? [{ kinds: [KIND_HANDLER_INFO], authors: [...authors], "#d": [...ids] }]
      : null;
  }, [recCoords]);
  const { events: coordHandlers } = useObserve(coordFilters);

  // Handlers we published this session — shown immediately, before they're observed back.
  const [sessionHandlers, setSessionHandlers] = useState<Handler[]>([]);
  // Optimistic recommend/unrecommend overrides, keyed by handler address.
  const [override, setOverride] = useState<Map<string, boolean>>(new Map());
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Latest kind-31989 recommendation the logged-in user holds, per kind — the
  // base we merge into when recommending, so we never clobber their other apps.
  const myRecByKind = useMemo(() => {
    const m = new Map<string, Recommendation>();
    if (!me) return m;
    for (const r of recommendations) {
      if (r.pubkey !== me) continue;
      const prev = m.get(r.kind);
      if (!prev || r.event.created_at > prev.event.created_at) m.set(r.kind, r);
    }
    return m;
  }, [recommendations, me]);

  const apps = useMemo<AppEntry[]>(() => {
    const nipKindSet = new Set(nipKinds);
    const handlers = new Map<string, Handler>();
    for (const e of [...kindHandlers, ...coordHandlers]) {
      const h = parseHandler(e);
      if (h) handlers.set(h.address, h);
    }
    for (const h of sessionHandlers) handlers.set(h.address, h);

    // Which of the NIP's kinds each handler was recommended for, and by whom.
    const recommenders = new Map<string, Set<string>>();
    const recKinds = new Map<string, Set<string>>();
    for (const r of recommendations) {
      if (!nipKindSet.has(r.kind)) continue;
      for (const addr of r.handlers) {
        (recommenders.get(addr) ?? recommenders.set(addr, new Set()).get(addr)!).add(
          r.pubkey,
        );
        (recKinds.get(addr) ?? recKinds.set(addr, new Set()).get(addr)!).add(r.kind);
      }
    }

    const entries: AppEntry[] = [];
    for (const h of handlers.values()) {
      const supported = new Set<string>();
      for (const k of nipKinds) if (h.kinds.has(k)) supported.add(k);
      for (const k of recKinds.get(h.address) ?? []) supported.add(k);
      if (supported.size === 0) continue;

      const who = recommenders.get(h.address) ?? new Set<string>();
      const ov = override.get(h.address);
      const mine = ov ?? (me ? who.has(me) : false);
      const netWho = [...who].filter(
        (pk) => pk !== me && (followSet.has(pk) || webOfTrust.has(pk)),
      );
      const score =
        netWho.reduce((s, pk) => s + weightOf(pk, followSet, webOfTrust), 0) +
        (mine ? 3 : 0);
      entries.push({
        handler: h,
        supportedKinds: [...supported].sort((a, b) => Number(a) - Number(b)),
        recommenders: new Set(netWho),
        score,
        mine,
      });
    }
    entries.sort(
      (a, b) =>
        b.score - a.score ||
        b.supportedKinds.length - a.supportedKinds.length ||
        a.handler.name.localeCompare(b.handler.name),
    );
    return entries;
  }, [
    kindHandlers,
    coordHandlers,
    sessionHandlers,
    recommendations,
    nipKinds,
    override,
    me,
    followSet,
    webOfTrust,
  ]);

  // Merge (or drop) a handler coordinate across the user's recommendations for a
  // set of kinds — one addressable kind-31989 per kind.
  const putRecommendation = useCallback(
    async (targetKinds: string[], address: string, add: boolean) => {
      if (!signer.getActiveSigner()) {
        toast.error("Re-authenticate to recommend an app.");
        onNeedsAuth?.();
        return false;
      }
      setPending((p) => new Set(p).add(address));
      setOverride((m) => new Map(m).set(address, add));
      try {
        for (const kind of targetKinds) {
          const existing = myRecByKind.get(kind);
          const coords = new Set(existing?.handlers ?? []);
          if (add) coords.add(address);
          else coords.delete(address);

          // Retracting the last handler for a kind: delete the empty recommendation.
          if (!add && coords.size === 0) {
            if (existing) {
              const del: EventTemplate = {
                kind: KIND_DELETE,
                created_at: Math.floor(Date.now() / 1000),
                content: "",
                tags: [
                  ["e", existing.event.id],
                  ["k", String(KIND_HANDLER_RECOMMENDATION)],
                ],
              };
              await dataLayer.publish(del);
            }
            continue;
          }

          const tmpl: EventTemplate = {
            kind: KIND_HANDLER_RECOMMENDATION,
            created_at: Math.floor(Date.now() / 1000),
            content: "",
            tags: [
              ["d", kind],
              ...[...coords].map((a) => ["a", a, relayHint]),
              ["client", CLIENT_NAME],
            ],
          };
          await dataLayer.publish(tmpl);
        }
        toast.success(add ? "App recommended." : "Recommendation removed.");
        return true;
      } catch (err) {
        setOverride((m) => new Map(m).set(address, !add)); // roll back
        toast.error(
          err instanceof Error ? err.message : "Failed to update recommendation.",
        );
        return false;
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(address);
          return next;
        });
      }
    },
    [myRecByKind, onNeedsAuth],
  );

  const recommend = useCallback(
    (entry: AppEntry) =>
      void putRecommendation(entry.supportedKinds, entry.handler.address, true),
    [putRecommendation],
  );
  const unrecommend = useCallback(
    (entry: AppEntry) =>
      void putRecommendation(entry.supportedKinds, entry.handler.address, false),
    [putRecommendation],
  );
  // Recommend a handler by coordinate (pasted naddr) for all of the NIP's kinds.
  const recommendByCoord = useCallback(
    (address: string) => putRecommendation(nipKinds, address, true),
    [putRecommendation, nipKinds],
  );

  const registerApp = useCallback(
    async (input: RegisterInput) => {
      const active = signer.getActiveSigner();
      const owner = signer.getActiveAccount()?.pubkey;
      if (!active || !owner) {
        onNeedsAuth?.();
        return false;
      }
      const d = crypto.randomUUID();
      const address = `${KIND_HANDLER_INFO}:${owner}:${d}`;
      const appKinds = input.kinds.length > 0 ? input.kinds : nipKinds;
      try {
        const content = JSON.stringify({
          name: input.name.trim(),
          picture: input.picture?.trim() || undefined,
          about: input.about?.trim() || undefined,
        });
        const tmpl: EventTemplate = {
          kind: KIND_HANDLER_INFO,
          created_at: Math.floor(Date.now() / 1000),
          content,
          tags: [
            ["d", d],
            ...appKinds.map((k) => ["k", k]),
            ["web", input.url.trim()],
            ["client", CLIENT_NAME],
          ],
        };
        const { event } = await dataLayer.publish(tmpl);
        const handler = parseHandler(event);
        if (handler) setSessionHandlers((prev) => [...prev, handler]);
        // Vouch for the app we just registered so it surfaces as recommended.
        await putRecommendation(appKinds, address, true);
        toast.success("App added and recommended.");
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to add the app.",
        );
        return false;
      }
    },
    [nipKinds, putRecommendation, onNeedsAuth],
  );

  return {
    apps,
    ready: eose,
    pending,
    recommend,
    unrecommend,
    recommendByCoord,
    registerApp,
  };
}
