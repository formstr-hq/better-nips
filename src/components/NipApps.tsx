import { useMemo, useState } from "react";
import { decode } from "nostr-tools/nip19";
import { useHandlers, type AppEntry } from "../hooks/useHandlers";
import { handlerWebUrl } from "../nostr/handlers";
import { KIND_HANDLER_INFO } from "../nostr/constants";
import type { NipKind } from "../nostr/nips";
import { toast } from "../lib/toast";

function kindLabel(kind: string, names: Map<string, string>): string {
  const name = names.get(kind);
  return name ? `kind ${kind} · ${name}` : `kind ${kind}`;
}

/** Decode a pasted naddr into a `31990:<pubkey>:<d>` handler coordinate. */
function handlerCoordFromNaddr(input: string): string | null {
  try {
    const d = decode(input.trim());
    if (d.type !== "naddr" || d.data.kind !== KIND_HANDLER_INFO) return null;
    return `${KIND_HANDLER_INFO}:${d.data.pubkey}:${d.data.identifier}`;
  } catch {
    return null;
  }
}

function AppRow({
  entry,
  kindNames,
  loggedIn,
  pending,
  onToggle,
}: {
  entry: AppEntry;
  kindNames: Map<string, string>;
  loggedIn: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const { handler, supportedKinds, recommenders, mine } = entry;
  const url = handlerWebUrl(handler);
  const name = handler.name || "Unnamed app";

  return (
    <div className="app-row">
      {handler.picture ? (
        <img className="avatar" src={handler.picture} alt="" />
      ) : (
        <div className="avatar placeholder" />
      )}
      <div className="app-main">
        <div className="app-name-row">
          {url ? (
            <a className="app-name" href={url} target="_blank" rel="noreferrer">
              {name} ↗
            </a>
          ) : (
            <span className="app-name">{name}</span>
          )}
        </div>
        <div className="kinds app-kinds">
          {supportedKinds.map((k) => (
            <span className="kind-chip" key={k}>
              {kindLabel(k, kindNames)}
            </span>
          ))}
        </div>
        {recommenders.size > 0 && (
          <span className="app-recommenders">
            Recommended by {recommenders.size} in your network
          </span>
        )}
      </div>
      {loggedIn && (
        <button
          className={`btn approve sm${mine ? " done" : ""}`}
          disabled={pending}
          onClick={onToggle}
          title={mine ? "Remove your recommendation" : "Recommend this app"}
        >
          {pending ? "…" : mine ? "✓ Recommended" : "Recommend"}
        </button>
      )}
    </div>
  );
}

function AddApp({
  nipKinds,
  onRegister,
  onRecommendCoord,
}: {
  nipKinds: NipKind[];
  onRegister: (input: {
    name: string;
    url: string;
    kinds: string[];
  }) => Promise<boolean>;
  onRecommendCoord: (address: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [naddr, setNaddr] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(nipKinds.map((k) => k.kind)),
  );
  const [busy, setBusy] = useState(false);

  const toggleKind = (k: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const reset = () => {
    setName("");
    setUrl("");
    setNaddr("");
    setSelected(new Set(nipKinds.map((k) => k.kind)));
    setOpen(false);
  };

  const submitNew = async () => {
    if (!name.trim() || !url.trim() || selected.size === 0) return;
    setBusy(true);
    const ok = await onRegister({
      name,
      url,
      kinds: [...selected],
    });
    setBusy(false);
    if (ok) reset();
  };

  const submitExisting = async () => {
    const coord = handlerCoordFromNaddr(naddr);
    if (!coord) {
      toast.error("That doesn't look like a handler naddr (kind 31990).");
      return;
    }
    setBusy(true);
    const ok = await onRecommendCoord(coord);
    setBusy(false);
    if (ok) reset();
  };

  if (!open) {
    return (
      <button className="link-btn add-app-toggle" onClick={() => setOpen(true)}>
        + Add an app
      </button>
    );
  }

  return (
    <div className="add-app-form">
      <div className="add-app-tabs">
        <button
          className={`tab${mode === "new" ? " active" : ""}`}
          onClick={() => setMode("new")}
        >
          Register a new app
        </button>
        <button
          className={`tab${mode === "existing" ? " active" : ""}`}
          onClick={() => setMode("existing")}
        >
          Recommend by naddr
        </button>
      </div>

      {mode === "new" ? (
        <>
          <label className="field">
            <span className="field-label">App name</span>
            <input
              className="search"
              placeholder="e.g. Nostrudel"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">App URL</span>
            <input
              className="search mono-input"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <div className="field">
            <span className="field-label">
              Supports{" "}
              <span className="field-hint">(which of this NIP's kinds)</span>
            </span>
            <div className="kinds add-app-kinds">
              {nipKinds.map((k) => (
                <button
                  key={k.kind}
                  className={`kind-chip toggle${selected.has(k.kind) ? " on" : ""}`}
                  onClick={() => toggleKind(k.kind)}
                >
                  kind {k.kind}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <label className="field">
          <span className="field-label">
            Handler naddr{" "}
            <span className="field-hint">(a kind-31990 app you know)</span>
          </span>
          <input
            className="search mono-input"
            placeholder="naddr1…"
            value={naddr}
            onChange={(e) => setNaddr(e.target.value)}
          />
        </label>
      )}

      <div className="add-app-actions">
        <button className="btn ghost sm" onClick={reset} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn sm"
          disabled={busy}
          onClick={() => void (mode === "new" ? submitNew() : submitExisting())}
        >
          {busy ? "Publishing…" : mode === "new" ? "Add app" : "Recommend"}
        </button>
      </div>
    </div>
  );
}

/**
 * "Apps related to this NIP" — NIP-89 handlers for the kinds this NIP defines,
 * surfaced (and rankable) through your follows + web-of-trust, with the ability
 * to recommend an existing handler or register a new app.
 */
export function NipApps({
  kinds,
  follows,
  webOfTrust,
  loggedIn,
  onNeedsAuth,
}: {
  kinds: NipKind[];
  follows: string[];
  webOfTrust: Set<string>;
  loggedIn: boolean;
  onNeedsAuth: () => void;
}) {
  const kindStrs = useMemo(() => kinds.map((k) => k.kind), [kinds]);
  const kindNames = useMemo(
    () => new Map(kinds.filter((k) => k.name).map((k) => [k.kind, k.name])),
    [kinds],
  );
  const {
    apps,
    ready,
    pending,
    recommend,
    unrecommend,
    recommendByCoord,
    registerApp,
  } = useHandlers(kindStrs, follows, webOfTrust, onNeedsAuth);

  if (kinds.length === 0) return null;

  return (
    <section className="nip-apps">
      <h2 className="nip-apps-title">Apps related to this NIP</h2>
      <p className="nip-apps-sub">
        Applications that support the kinds this NIP defines, surfaced by your
        network (NIP-89).
      </p>

      {apps.length > 0 ? (
        <div className="app-list">
          {apps.map((entry) => (
            <AppRow
              key={entry.handler.address}
              entry={entry}
              kindNames={kindNames}
              loggedIn={loggedIn}
              pending={pending.has(entry.handler.address)}
              onToggle={() =>
                entry.mine ? unrecommend(entry) : recommend(entry)
              }
            />
          ))}
        </div>
      ) : (
        <p className="empty-inline">
          {ready
            ? "No apps recommend these kinds yet. Know one? Add it below."
            : "Looking for apps…"}
        </p>
      )}

      {loggedIn ? (
        <AddApp
          nipKinds={kinds}
          onRegister={registerApp}
          onRecommendCoord={recommendByCoord}
        />
      ) : (
        <button className="link-btn add-app-toggle" onClick={onNeedsAuth}>
          Connect a signer to recommend an app
        </button>
      )}
    </section>
  );
}
