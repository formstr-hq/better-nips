import { npubEncode } from "nostr-tools/nip19";
import type { ScoredNip, Profile } from "../hooks/useNips";
import { ProfileLink } from "./ProfileLink";

function authorLabel(pubkey: string, profile?: Profile): string {
  if (profile?.name) return profile.name;
  try {
    return `${npubEncode(pubkey).slice(0, 12)}…`;
  } catch {
    return pubkey.slice(0, 12);
  }
}

export interface ApproverRef {
  pubkey: string;
  profile?: Profile;
}

function AvatarStack({ refs }: { refs: ApproverRef[] }) {
  return (
    <span className="avatar-stack">
      {refs.slice(0, 4).map((a) => (
        <ProfileLink
          key={a.pubkey}
          pubkey={a.pubkey}
          title={authorLabel(a.pubkey, a.profile)}
        >
          {a.profile?.picture ? (
            <img className="avatar xs" src={a.profile.picture} alt="" />
          ) : (
            <span className="avatar xs placeholder" />
          )}
        </ProfileLink>
      ))}
    </span>
  );
}

export function NipCard({
  nip,
  profile,
  approvalCount,
  disapprovalCount,
  networkApprovers,
  networkDisapprovers,
  approved,
  disapproved,
  pending,
  onApprove,
  onDisapprove,
  onRetract,
  onOpen,
}: {
  nip: ScoredNip;
  profile?: Profile;
  approvalCount: number;
  disapprovalCount: number;
  networkApprovers: ApproverRef[];
  networkDisapprovers: ApproverRef[];
  approved: boolean;
  disapproved: boolean;
  pending: boolean;
  onApprove: () => void;
  onDisapprove: () => void;
  onRetract: () => void;
  onOpen: () => void;
}) {
  const hasVerdicts =
    networkApprovers.length > 0 || networkDisapprovers.length > 0;
  return (
    <article
      className="card"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="card-head">
        <ProfileLink
          pubkey={nip.pubkey}
          className="author"
          title={authorLabel(nip.pubkey, profile)}
        >
          {profile?.picture ? (
            <img className="avatar" src={profile.picture} alt="" />
          ) : (
            <div className="avatar placeholder" />
          )}
          <span>{authorLabel(nip.pubkey, profile)}</span>
        </ProfileLink>
        <div className="verdict-buttons">
          <button
            className={`btn approve${approved ? " done" : ""}`}
            disabled={pending}
            onClick={(e) => {
              e.stopPropagation();
              if (approved) onRetract();
              else onApprove();
            }}
            title={
              approved ? "Click to retract your approval" : "Publish a NIP-32 approval"
            }
          >
            {pending ? "…" : approved ? "✓" : "Approve"}
            <span className="count">{approvalCount}</span>
          </button>
          <button
            className={`btn disapprove icon-only${disapproved ? " done" : ""}`}
            disabled={pending}
            onClick={(e) => {
              e.stopPropagation();
              if (disapproved) onRetract();
              else onDisapprove();
            }}
            title={
              disapproved
                ? "Click to retract your disapproval"
                : "Publish a NIP-32 disapproval"
            }
          >
            {disapproved ? "✓" : "👎"}
            {disapprovalCount > 0 && <span className="count">{disapprovalCount}</span>}
          </button>
        </div>
      </div>

      {hasVerdicts && (
        <div className="approver-row">
          {networkApprovers.length > 0 && (
            <span
              className="verdict-chip approve"
              title="Approvers in your network"
            >
              <AvatarStack refs={networkApprovers} />
              <span className="approver-text">
                {approverSummary(networkApprovers)}
              </span>
            </span>
          )}
          {networkDisapprovers.length > 0 && (
            <span
              className="verdict-chip disapprove"
              title="Disapprovers in your network"
            >
              <AvatarStack refs={networkDisapprovers} />
              <span className="disapprover-text">
                {networkDisapprovers.length} disapproved
              </span>
            </span>
          )}
        </div>
      )}

      <h2 className="card-title">{nip.title}</h2>
      {nip.summary && <p className="card-summary">{nip.summary}</p>}

      <div className="card-foot">
        {nip.kinds.length > 0 ? (
          <div className="kinds">
            {nip.kinds.slice(0, 4).map((k) => (
              <span className="kind-chip" key={k.kind}>
                kind {k.kind}
                {k.name ? ` · ${k.name}` : ""}
              </span>
            ))}
            {nip.kinds.length > 4 && (
              <span className="kind-chip more">+{nip.kinds.length - 4}</span>
            )}
          </div>
        ) : (
          <span />
        )}
        <span className="card-date">
          <time dateTime={new Date(nip.createdAt * 1000).toISOString()}>
            {formatDate(nip.createdAt)}
          </time>
          <span className="read-link">Read →</span>
        </span>
      </div>
    </article>
  );
}

/** "Approved by Alice, Bob +3 in your network" — names where known. */
function approverSummary(approvers: ApproverRef[]): string {
  const names = approvers
    .slice(0, 2)
    .map((a) => a.profile?.name || shortName(a.pubkey));
  const rest = approvers.length - names.length;
  const lead = names.join(", ");
  return `Approved by ${lead}${rest > 0 ? ` +${rest}` : ""} in your network`;
}

function shortName(pubkey: string): string {
  try {
    return `${npubEncode(pubkey).slice(0, 9)}…`;
  } catch {
    return pubkey.slice(0, 8);
  }
}

/** Short, relative-ish published date for a card. */
function formatDate(unixSeconds: number): string {
  const then = unixSeconds * 1000;
  const days = (Date.now() - then) / 86_400_000;
  if (days < 1) return "today";
  if (days < 30) return `${Math.floor(days)}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}
