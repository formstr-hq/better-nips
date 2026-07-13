import { useEffect, useMemo } from "react";
import { npubEncode } from "nostr-tools/nip19";
import { useNipByAddress } from "../hooks/useNipByAddress";
import { useProfile, useProfiles } from "../hooks/useNips";
import { useApprove } from "../hooks/useApprove";
import { useDeleteNip } from "../hooks/useDeleteNip";
import { signer } from "../nostr/bootstrap";
import { APP_NAME, APP_TAGLINE } from "../nostr/constants";
import { Markdown } from "../lib/markdown";
import { toast } from "../lib/toast";
import { ApproverStack } from "./ApproverStack";
import { FeedbackBar } from "./FeedbackBar";
import { NipApps } from "./NipApps";
import { ProfileLink } from "./ProfileLink";

function authorLabel(pubkey: string, name?: string): string {
  if (name) return name;
  try {
    return npubEncode(pubkey).slice(0, 16) + "…";
  } catch {
    return pubkey.slice(0, 16);
  }
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${what}.`);
  } catch {
    toast.error("Couldn't access the clipboard.");
  }
}

/**
 * Standalone, shareable NIP screen (route `/nip/<naddr>`). Resolves the NIP
 * from its address — works cold from a shared link and warm from the local
 * cache — and renders the full Markdown body, approvals, and share/approve.
 */
export function NipPage({
  id,
  follows,
  webOfTrust,
  onNeedsAuth,
  onBack,
  onEdit,
  onDeleted,
}: {
  id: string;
  follows: string[];
  webOfTrust: Set<string>;
  onNeedsAuth: () => void;
  onBack: () => void;
  /** Open the editor for this NIP (owner only). */
  onEdit: () => void;
  /** Called after a successful deletion request (owner only). */
  onDeleted: () => void;
}) {
  const networkAuthors = useMemo(
    () => [...new Set([...follows, ...webOfTrust])],
    [follows, webOfTrust],
  );
  const { nip, approvers, disapprovers, ready, coord } = useNipByAddress(
    id,
    networkAuthors,
  );
  const profile = useProfile(nip?.pubkey ?? null);
  const { approve, disapprove, retract, approved, disapproved, pending } =
    useApprove(onNeedsAuth);
  const { remove, deleting } = useDeleteNip(onNeedsAuth);
  const verdictProfiles = useProfiles(
    useMemo(() => [...approvers, ...disapprovers], [approvers, disapprovers]),
  );

  useEffect(() => {
    document.title = nip ? `${nip.title} — ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = `${APP_NAME} — ${APP_TAGLINE.toLowerCase()}`;
    };
  }, [nip]);

  const me = signer.getActiveAccount()?.pubkey ?? "";
  const isOwner = !!nip && nip.pubkey === me;
  const isApproved = nip ? approved.has(nip.address) : false;
  const isDisapproved = nip ? disapproved.has(nip.address) : false;
  const meApproved = !!nip && approvers.has(me);
  const meDisapproved = !!nip && disapprovers.has(me);
  // Global counts reconciled with the optimistic self-verdict: add when we've
  // just voted but the label isn't observed yet, subtract when we've retracted
  // or switched away but the prior label is still observed.
  const count =
    approvers.size +
    (isApproved && !meApproved ? 1 : 0) -
    (!isApproved && meApproved ? 1 : 0);
  const disapprovalCount =
    disapprovers.size +
    (isDisapproved && !meDisapproved ? 1 : 0) -
    (!isDisapproved && meDisapproved ? 1 : 0);
  // Verdict pubkeys for the stack, folding the optimistic self-verdict in/out.
  const approverPubkeys = useMemo(() => {
    let list = [...approvers];
    if (isApproved && me && !approvers.has(me)) list.unshift(me);
    if (!isApproved && me && approvers.has(me))
      list = list.filter((pk) => pk !== me);
    return list;
  }, [approvers, isApproved, me]);
  const disapproverPubkeys = useMemo(() => {
    let list = [...disapprovers];
    if (isDisapproved && me && !disapprovers.has(me)) list.unshift(me);
    if (!isDisapproved && me && disapprovers.has(me))
      list = list.filter((pk) => pk !== me);
    return list;
  }, [disapprovers, isDisapproved, me]);

  if (!coord) {
    return (
      <div className="nip-page">
        <button className="back-link" onClick={onBack}>
          ← Back to NIPs
        </button>
        <p className="empty">That NIP link doesn’t look valid.</p>
      </div>
    );
  }

  if (!nip) {
    return (
      <div className="nip-page">
        <button className="back-link" onClick={onBack}>
          ← Back to NIPs
        </button>
        {ready ? (
          <p className="empty">
            Couldn’t find this NIP on your relays. It may live on relays you’re
            not connected to.
          </p>
        ) : (
          <div className="card skeleton">
            <div className="sk-row" />
            <div className="sk-title" />
            <div className="sk-line" />
            <div className="sk-line short" />
          </div>
        )}
      </div>
    );
  }

  const created = new Date(nip.createdAt * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Delete “${nip.title}”? This publishes a deletion request to your relays. It can't be reliably undone.`,
      )
    )
      return;
    if (await remove(nip)) onDeleted();
  };

  return (
    <article className="nip-page">
      <div className="nip-page-nav">
        <button className="back-link" onClick={onBack}>
          ← Back to NIPs
        </button>
        <div className="nip-page-nav-actions">
          {isOwner && (
            <>
              <button className="btn ghost sm" onClick={onEdit}>
                Edit
              </button>
              <button
                className="btn ghost sm danger"
                disabled={deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          )}
          <button
            className="btn ghost sm"
            onClick={() =>
              void copy(window.location.href, "shareable link")
            }
          >
            Copy link
          </button>
        </div>
      </div>

      <ProfileLink
        pubkey={nip.pubkey}
        className="author detail-author"
        title={authorLabel(nip.pubkey, profile?.name)}
      >
        {profile?.picture ? (
          <img className="avatar" src={profile.picture} alt="" />
        ) : (
          <div className="avatar placeholder" />
        )}
        <div className="author-meta">
          <span className="author-name">
            {authorLabel(nip.pubkey, profile?.name)}
          </span>
          {profile?.nip05 && <span className="nip05">{profile.nip05}</span>}
        </div>
      </ProfileLink>

      <ApproverStack
        approvers={approverPubkeys}
        disapprovers={disapproverPubkeys}
        profiles={verdictProfiles}
        follows={follows}
        webOfTrust={webOfTrust}
        me={me}
      />

      <h1 className="sheet-title">{nip.title}</h1>
      <div className="sheet-meta">
        <span>Published {created}</span>
        <span className="dot-sep">·</span>
        <span>
          {count} approval{count === 1 ? "" : "s"}
        </span>
      </div>

      {nip.kinds.length > 0 && (
        <div className="kinds detail-kinds">
          {nip.kinds.map((k) => (
            <span className="kind-chip" key={k.kind}>
              kind {k.kind}
              {k.name ? ` · ${k.name}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="markdown nip-page-body">
        {nip.content.trim() ? (
          <Markdown source={nip.content} />
        ) : (
          <p className="empty-inline">
            This NIP has no body content — only metadata.
          </p>
        )}
      </div>

      <div className="nip-page-actions">
        <button
          className={`btn approve big${isApproved ? " done" : ""}`}
          disabled={pending.has(nip.address)}
          onClick={() => void (isApproved ? retract(nip) : approve(nip))}
          title={
            isApproved
              ? "Click to retract your approval"
              : "Publish a NIP-32 approval"
          }
        >
          {pending.has(nip.address)
            ? "Publishing…"
            : isApproved
              ? "✓ Approved"
              : "Approve"}
          <span className="count">{count}</span>
        </button>
        <button
          className={`btn disapprove big${isDisapproved ? " done" : ""}`}
          disabled={pending.has(nip.address)}
          onClick={() => void (isDisapproved ? retract(nip) : disapprove(nip))}
          title={
            isDisapproved
              ? "Click to retract your disapproval"
              : "Publish a NIP-32 disapproval"
          }
        >
          {pending.has(nip.address)
            ? "Publishing…"
            : isDisapproved
              ? "✓ Disapproved"
              : "Disapprove"}
          {disapprovalCount > 0 && (
            <span className="count">{disapprovalCount}</span>
          )}
        </button>
        <button
          className="btn ghost"
          onClick={() => void copy(nip.address, "address")}
        >
          Copy address
        </button>
      </div>

      <NipApps
        kinds={nip.kinds}
        follows={follows}
        webOfTrust={webOfTrust}
        loggedIn={!!me}
        onNeedsAuth={onNeedsAuth}
      />

      <FeedbackBar
        nip={nip}
        recipient={profile ?? undefined}
        recipientName={authorLabel(nip.pubkey, profile?.name)}
        loggedIn={!!me}
        onNeedsAuth={onNeedsAuth}
      />
    </article>
  );
}
