import { useEffect, useMemo, useState } from "react";
import type { EventTemplate } from "nostr-tools";
import { dataLayer, signer } from "../nostr/bootstrap";
import { CLIENT_NAME, KIND_NIP } from "../nostr/constants";
import { naddrOf } from "../nostr/nips";
import { useNipByAddress } from "../hooks/useNipByAddress";
import { Markdown } from "../lib/markdown";
import { toast } from "../lib/toast";

interface KindRow {
  kind: string;
  name: string;
}

/** A URL-safe identifier derived from the title (the addressable `d` tag). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * Compose and publish a community NIP (addressable kind-30817). Mirrors the
 * NostrHub "NIPs on Nostr" shape: a `d` identifier, a `title`, zero or more `k`
 * (kind) declarations, and a Markdown body. Editing an existing NIP is just
 * publishing again with the same `d`: pass `editId` to load the NIP into the
 * form and lock its identifier so the republish replaces it in place.
 */
export function ComposeNip({
  loggedIn,
  editId,
  onNeedsAuth,
  onBack,
  onPublished,
}: {
  loggedIn: boolean;
  /** naddr of a NIP to edit; omit to compose a new one. */
  editId?: string;
  onNeedsAuth: () => void;
  onBack: () => void;
  onPublished: (naddr: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [touchedId, setTouchedId] = useState(false);
  const [kinds, setKinds] = useState<KindRow[]>([{ kind: "", name: "" }]);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // In edit mode, load the existing NIP and seed the form once it arrives.
  const isEditing = !!editId;
  const { nip: existing, ready: existingReady } = useNipByAddress(editId ?? "");
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!isEditing || seeded || !existing) return;
    setTitle(existing.title);
    setTouchedId(true);
    setIdentifier(existing.d);
    setKinds(
      existing.kinds.length > 0
        ? existing.kinds.map((k) => ({ kind: k.kind, name: k.name }))
        : [{ kind: "", name: "" }],
    );
    setBody(existing.content);
    setSeeded(true);
  }, [isEditing, seeded, existing]);

  // The d-tag follows the title until the user edits it directly; in edit mode
  // it's pinned to the loaded identifier so the republish replaces in place.
  const effectiveId = touchedId ? identifier : slugify(title);
  const canPublish = title.trim().length > 0 && effectiveId.length > 0;

  const cleanKinds = useMemo(
    () => kinds.filter((k) => /^\d+$/.test(k.kind.trim())),
    [kinds],
  );

  const updateKind = (i: number, patch: Partial<KindRow>) =>
    setKinds((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addKind = () => setKinds((rows) => [...rows, { kind: "", name: "" }]);
  const removeKind = (i: number) =>
    setKinds((rows) => (rows.length === 1 ? rows : rows.filter((_, j) => j !== i)));

  const publish = async () => {
    if (!canPublish) return;
    const active = signer.getActiveSigner();
    const me = signer.getActiveAccount()?.pubkey;
    if (!active || !me) {
      onNeedsAuth();
      return;
    }
    setPublishing(true);
    try {
      const tags: string[][] = [
        ["d", effectiveId],
        ["title", title.trim()],
        ...cleanKinds.map((k) =>
          k.name.trim() ? ["k", k.kind.trim(), k.name.trim()] : ["k", k.kind.trim()],
        ),
        ["client", CLIENT_NAME],
      ];
      const template: EventTemplate = {
        kind: KIND_NIP,
        created_at: Math.floor(Date.now() / 1000),
        content: body,
        tags,
      };
      const { result } = await dataLayer.publish(template);
      if (result.accepted > 0) {
        toast.success(
          `${isEditing ? "Updated" : "Published"} on ${result.accepted}/${result.total} relays.`,
        );
        onPublished(naddrOf({ pubkey: me, d: effectiveId }));
      } else {
        toast.error("Signed but no relay accepted it. Try different relays.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish NIP.");
    } finally {
      setPublishing(false);
    }
  };

  // Edit mode waits for the NIP to load before it can seed the form.
  if (isEditing && !seeded) {
    return (
      <div className="compose">
        <div className="nip-page-nav">
          <button className="back-link" onClick={onBack}>
            ← Back
          </button>
        </div>
        <h1 className="page-title">Edit NIP</h1>
        {existingReady && !existing ? (
          <p className="empty">
            Couldn’t load this NIP to edit. It may live on relays you’re not
            connected to.
          </p>
        ) : (
          <div className="card skeleton">
            <div className="sk-title" />
            <div className="sk-line" />
            <div className="sk-line short" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="compose">
      <div className="nip-page-nav">
        <button className="back-link" onClick={onBack}>
          {isEditing ? "← Back" : "← Back to NIPs"}
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit" : "Preview"}
        </button>
      </div>

      <h1 className="page-title">{isEditing ? "Edit NIP" : "Write a NIP"}</h1>

      {!loggedIn && (
        <p className="muted-block compose-note">
          You can draft freely — you'll be asked to connect a signer when you
          publish.
        </p>
      )}

      {preview ? (
        <article className="compose-preview">
          <h1 className="sheet-title">{title || "Untitled NIP"}</h1>
          {cleanKinds.length > 0 && (
            <div className="kinds detail-kinds">
              {cleanKinds.map((k, i) => (
                <span className="kind-chip" key={`${k.kind}-${i}`}>
                  kind {k.kind}
                  {k.name ? ` · ${k.name}` : ""}
                </span>
              ))}
            </div>
          )}
          <div className="markdown nip-page-body">
            {body.trim() ? (
              <Markdown source={body} />
            ) : (
              <p className="empty-inline">Nothing to preview yet.</p>
            )}
          </div>
        </article>
      ) : (
        <div className="compose-form">
          <label className="field">
            <span className="field-label">Title</span>
            <input
              className="search"
              placeholder="e.g. Encrypted Group Events"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">
              Identifier{" "}
              <span className="field-hint">
                {isEditing
                  ? "(fixed — editing replaces this NIP in place)"
                  : "(the addressable d-tag)"}
              </span>
            </span>
            <input
              className="search mono-input"
              placeholder="auto-generated from title"
              value={effectiveId}
              disabled={isEditing}
              onChange={(e) => {
                setTouchedId(true);
                setIdentifier(slugify(e.target.value));
              }}
            />
          </label>

          <div className="field">
            <span className="field-label">
              Kinds <span className="field-hint">(event kinds this NIP defines)</span>
            </span>
            <div className="kind-rows">
              {kinds.map((row, i) => (
                <div className="kind-row" key={i}>
                  <input
                    className="search kind-num"
                    inputMode="numeric"
                    placeholder="kind #"
                    value={row.kind}
                    onChange={(e) =>
                      updateKind(i, { kind: e.target.value.replace(/\D/g, "") })
                    }
                  />
                  <input
                    className="search"
                    placeholder="name (optional)"
                    value={row.name}
                    onChange={(e) => updateKind(i, { name: e.target.value })}
                  />
                  <button
                    className="icon-btn"
                    onClick={() => removeKind(i)}
                    aria-label="Remove kind"
                    disabled={kinds.length === 1}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="link-btn" onClick={addKind}>
              + Add kind
            </button>
          </div>

          <label className="field">
            <span className="field-label">
              Body <span className="field-hint">(Markdown)</span>
            </span>
            <textarea
              className="compose-body"
              rows={16}
              placeholder={"## Abstract\n\nDescribe the NIP…"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
        </div>
      )}

      <div className="nip-page-actions">
        <button
          className="btn big"
          onClick={() => void publish()}
          disabled={!canPublish || publishing}
        >
          {publishing
            ? isEditing
              ? "Saving…"
              : "Publishing…"
            : isEditing
              ? "Save changes"
              : "Publish NIP"}
        </button>
        <span className="result-count">
          {KIND_NIP}:…:{effectiveId || "?"}
        </span>
      </div>
    </div>
  );
}
