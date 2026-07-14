import { useCallback, useMemo, useState } from "react";
import type { EventTemplate, Filter } from "nostr-tools";
import { useObserve } from "./useObserve";
import { dataLayer, signer } from "../nostr/bootstrap";
import { CLIENT_NAME, KIND_HANDLER_INFO } from "../nostr/constants";
import type { Surface } from "./useNips";
import { toast } from "../lib/toast";
import { parseHandler, type Handler } from "../nostr/handlers";

/** A registered app in the directory, plus whether the logged-in user authored it. */
export interface DirectoryApp {
  handler: Handler;
  mine: boolean;
}

/** Fields an app registration can be edited with (mirrors RegisterInput, minus `d`). */
export interface AppEdit {
  name: string;
  url: string;
  picture?: string;
  about?: string;
  kinds: string[];
}

/**
 * Browsable NIP-89 app directory (kind-31990 handler-info events), scoped by the
 * viewer's trust graph — Following, Web of Trust, or Global — with the viewer's
 * own registrations always merged in so they can be edited regardless of scope.
 *
 * Editing republishes a 31990 with the *same* `d` tag: kind-31990 is addressable,
 * so relays replace the prior version rather than keeping both.
 */
export function useAppDirectory(
  surface: Surface,
  follows: string[],
  webOfTrust: Set<string>,
) {
  const me = signer.getActiveAccount()?.pubkey ?? null;

  const authors = useMemo(() => {
    if (surface === "following") return [...new Set(follows)];
    if (surface === "web-of-trust")
      return [...new Set([...follows, ...webOfTrust])];
    return null; // global — no author filter
  }, [surface, follows, webOfTrust]);

  const filters: Filter[] | null = useMemo(() => {
    if (authors && authors.length === 0) return null;
    return authors
      ? [{ kinds: [KIND_HANDLER_INFO], authors, limit: 500 }]
      : [{ kinds: [KIND_HANDLER_INFO], limit: 500 }];
  }, [authors]);
  const { events, eose } = useObserve(filters);

  // The viewer's own apps, always loaded so they're editable in any scope.
  const myFilters: Filter[] | null = me
    ? [{ kinds: [KIND_HANDLER_INFO], authors: [me] }]
    : null;
  const { events: myEvents } = useObserve(myFilters);

  // Apps republished this session — shown immediately, before observed back.
  const [sessionHandlers, setSessionHandlers] = useState<Handler[]>([]);

  const apps = useMemo<DirectoryApp[]>(() => {
    const handlers = new Map<string, Handler>();
    for (const e of [...events, ...myEvents]) {
      const h = parseHandler(e);
      if (h) handlers.set(h.address, h);
    }
    // Session republishes win — they carry the freshest edit.
    for (const h of sessionHandlers) handlers.set(h.address, h);
    return [...handlers.values()]
      .map((handler) => ({ handler, mine: !!me && handler.pubkey === me }))
      .sort(
        (a, b) =>
          Number(b.mine) - Number(a.mine) ||
          b.handler.createdAt - a.handler.createdAt,
      );
  }, [events, myEvents, sessionHandlers, me]);

  const [pending, setPending] = useState<Set<string>>(new Set());

  // Register a brand-new app in the directory: a fresh `d` ⇒ a new kind-31990,
  // rather than replacing an existing registration the way updateApp does.
  const registerApp = useCallback(async (input: AppEdit) => {
    const active = signer.getActiveSigner();
    const owner = signer.getActiveAccount()?.pubkey;
    if (!active || !owner) {
      toast.error("Re-authenticate to add an app.");
      return false;
    }
    const d = crypto.randomUUID();
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
          ...input.kinds.map((k) => ["k", k]),
          ["web", input.url.trim()],
          ["client", CLIENT_NAME],
        ],
      };
      const { event } = await dataLayer.publish(tmpl);
      const handler = parseHandler(event);
      if (handler) setSessionHandlers((prev) => [...prev, handler]);
      toast.success("App added.");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add the app.");
      return false;
    }
  }, []);

  const updateApp = useCallback(
    async (handler: Handler, input: AppEdit) => {
      const active = signer.getActiveSigner();
      const owner = signer.getActiveAccount()?.pubkey;
      if (!active || !owner) {
        toast.error("Re-authenticate to edit an app.");
        return false;
      }
      if (handler.pubkey !== owner) {
        toast.error("You can only edit apps you registered.");
        return false;
      }
      setPending((p) => new Set(p).add(handler.address));
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
            ["d", handler.d], // same d ⇒ replaces the prior registration
            ...input.kinds.map((k) => ["k", k]),
            ["web", input.url.trim()],
            ["client", CLIENT_NAME],
          ],
        };
        const { event } = await dataLayer.publish(tmpl);
        const updated = parseHandler(event);
        if (updated)
          setSessionHandlers((prev) => [
            ...prev.filter((h) => h.address !== updated.address),
            updated,
          ]);
        toast.success("App updated.");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update the app.");
        return false;
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(handler.address);
          return next;
        });
      }
    },
    [],
  );

  return { apps, ready: eose, pending, registerApp, updateApp, loggedIn: !!me };
}
