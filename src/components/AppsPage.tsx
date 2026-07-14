import { useMemo, useState } from "react";
import { naddrEncode } from "nostr-tools/nip19";
import { ScopeTabs } from "./ScopeTabs";
import { useAppDirectory, type AppEdit } from "../hooks/useAppDirectory";
import { handlerWebUrl, type Handler } from "../nostr/handlers";
import { KIND_HANDLER_INFO } from "../nostr/constants";
import type { Surface } from "../hooks/useNips";
import { toast } from "../lib/toast";

function naddrFor(h: Handler): string {
  return naddrEncode({
    identifier: h.d,
    pubkey: h.pubkey,
    kind: KIND_HANDLER_INFO,
  });
}

/** Parse a comma/space separated list of kind numbers into unique kind strings. */
function parseKinds(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s)),
    ),
  ];
}

/** The add/edit form for an app registration. With no `handler`, it registers a new one. */
function AppForm({
  handler,
  busy,
  saveLabel,
  savingLabel,
  onSave,
  onCancel,
}: {
  handler?: Handler;
  busy: boolean;
  saveLabel: string;
  savingLabel: string;
  onSave: (input: AppEdit) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(handler?.name ?? "");
  const [url, setUrl] = useState(handler ? handlerWebUrl(handler) ?? "" : "");
  const [picture, setPicture] = useState(handler?.picture ?? "");
  const [about, setAbout] = useState(handler?.about ?? "");
  const [kinds, setKinds] = useState(
    handler
      ? [...handler.kinds].sort((a, b) => Number(a) - Number(b)).join(", ")
      : "",
  );

  const save = () => {
    const parsed = parseKinds(kinds);
    if (!name.trim() || !url.trim() || parsed.length === 0) {
      toast.error("Name, URL and at least one kind are required.");
      return;
    }
    onSave({ name, url, picture, about, kinds: parsed });
  };

  return (
    <div className="add-app-form app-edit-form">
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
      <label className="field">
        <span className="field-label">Icon URL</span>
        <input
          className="search mono-input"
          placeholder="https://…/icon.png"
          value={picture}
          onChange={(e) => setPicture(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">About</span>
        <input
          className="search"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="field-label">
          Kinds <span className="field-hint">(comma-separated numbers)</span>
        </span>
        <input
          className="search mono-input"
          placeholder="e.g. 30023, 30024"
          value={kinds}
          onChange={(e) => setKinds(e.target.value)}
        />
      </label>
      <div className="add-app-actions">
        <button className="btn ghost sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn sm" onClick={save} disabled={busy}>
          {busy ? savingLabel : saveLabel}
        </button>
      </div>
    </div>
  );
}

function DirectoryRow({
  handler,
  mine,
  busy,
  onSave,
}: {
  handler: Handler;
  mine: boolean;
  busy: boolean;
  onSave: (input: AppEdit) => void;
}) {
  const [editing, setEditing] = useState(false);
  const url = handlerWebUrl(handler);
  const name = handler.name || "Unnamed app";
  const kinds = [...handler.kinds].sort((a, b) => Number(a) - Number(b));

  const copyNaddr = async () => {
    try {
      await navigator.clipboard.writeText(naddrFor(handler));
      toast.success("naddr copied.");
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  return (
    <div className="app-row directory-row">
      <div className="directory-row-head">
        {handler.picture ? (
          <img className="avatar" src={handler.picture} alt="" />
        ) : (
          <div className="avatar placeholder" />
        )}
        <div className="app-main">
          <div className="app-name-row">
            {url ? (
              <a
                className="app-name"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                {name} ↗
              </a>
            ) : (
              <span className="app-name">{name}</span>
            )}
            {mine && <span className="mine-tag">yours</span>}
          </div>
          <div className="kinds app-kinds">
            {kinds.length > 0 ? (
              kinds.map((k) => (
                <span className="kind-chip" key={k}>
                  kind {k}
                </span>
              ))
            ) : (
              <span className="field-hint">declares no kinds</span>
            )}
          </div>
        </div>
        <div className="directory-row-actions">
          <button className="btn ghost sm" onClick={() => void copyNaddr()}>
            Copy naddr
          </button>
          {mine && (
            <button className="btn sm" onClick={() => setEditing((e) => !e)}>
              {editing ? "Close" : "Edit"}
            </button>
          )}
        </div>
      </div>
      {editing && mine && (
        <AppForm
          handler={handler}
          busy={busy}
          saveLabel="Save changes"
          savingLabel="Saving…"
          onSave={(input) => {
            onSave(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * "App directory" — every NIP-89 app registration (kind-31990), browsable by
 * trust scope, with a copyable naddr for each and inline editing of your own.
 */
export function AppsPage({
  follows,
  webOfTrust,
  loggedIn,
  onBack,
}: {
  follows: string[];
  webOfTrust: Set<string>;
  loggedIn: boolean;
  onBack: () => void;
}) {
  const [surface, setSurface] = useState<Surface>("following");
  const [adding, setAdding] = useState(false);

  const disabled = useMemo(() => {
    const set = new Set<Surface>();
    if (!loggedIn || follows.length === 0) {
      set.add("following");
      set.add("web-of-trust");
    }
    return set;
  }, [loggedIn, follows.length]);
  const effective: Surface = disabled.has(surface) ? "global" : surface;

  const { apps, ready, pending, registerApp, updateApp } = useAppDirectory(
    effective,
    follows,
    webOfTrust,
  );
  const [addBusy, setAddBusy] = useState(false);

  const add = async (input: AppEdit) => {
    setAddBusy(true);
    const ok = await registerApp(input);
    setAddBusy(false);
    if (ok) setAdding(false);
  };

  return (
    <section className="apps-page">
      <button className="link-btn back" onClick={onBack}>
        ← Back
      </button>
      <h1 className="apps-page-title">App directory</h1>
      <p className="apps-page-sub">
        Every NIP-89 app registration, surfaced by your network. Copy an app's
        naddr to recommend it elsewhere, or edit apps you registered.
      </p>

      {loggedIn &&
        (adding ? (
          <AppForm
            busy={addBusy}
            saveLabel="Add app"
            savingLabel="Adding…"
            onSave={(input) => void add(input)}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button
            className="link-btn add-app-toggle"
            onClick={() => setAdding(true)}
          >
            + Add an app
          </button>
        ))}

      <ScopeTabs surface={effective} onChange={setSurface} disabled={disabled} />

      {apps.length > 0 ? (
        <div className="app-list directory-list">
          {apps.map(({ handler, mine }) => (
            <DirectoryRow
              key={handler.address}
              handler={handler}
              mine={mine}
              busy={pending.has(handler.address)}
              onSave={(input) => void updateApp(handler, input)}
            />
          ))}
        </div>
      ) : (
        <p className="empty-inline">
          {ready ? "No apps found in this scope." : "Loading apps…"}
        </p>
      )}
    </section>
  );
}
