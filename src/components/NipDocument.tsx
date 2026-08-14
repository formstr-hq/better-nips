import type { ReactNode } from "react";
import { npubEncode } from "nostr-tools/nip19";
import type { Nip } from "../nostr/nips";
import type { Profile } from "../hooks/useNips";
import { POLLERAMA_URL } from "../nostr/constants";
import { Markdown } from "../lib/markdown";

export function authorLabel(pubkey: string, name?: string): string {
  if (name) return name;
  try {
    return `${npubEncode(pubkey).slice(0, 16)}...`;
  } catch {
    return pubkey.slice(0, 16);
  }
}

export function publishedDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp * 1000));
}

function profileUrl(pubkey: string): string {
  try {
    return `${POLLERAMA_URL}/profile/${npubEncode(pubkey)}`;
  } catch {
    return `${POLLERAMA_URL}/profile/${pubkey}`;
  }
}

function safePicture(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function NipDocument({
  nip,
  profile,
  verdict,
  approvalCount,
}: {
  nip: Nip;
  profile?: Profile | null;
  verdict?: ReactNode;
  approvalCount?: number;
}) {
  const label = authorLabel(nip.pubkey, profile?.name);
  const picture = safePicture(profile?.picture);

  return (
    <>
      <a
        className="profile-link author detail-author"
        href={profileUrl(nip.pubkey)}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
      >
        {picture ? (
          <img className="avatar" src={picture} alt="" />
        ) : (
          <div className="avatar placeholder" />
        )}
        <div className="author-meta">
          <span className="author-name">{label}</span>
          {profile?.nip05 && <span className="nip05">{profile.nip05}</span>}
        </div>
      </a>

      {verdict}

      <h1 className="sheet-title">{nip.title}</h1>
      <div className="sheet-meta">
        <span>Published {publishedDate(nip.createdAt)}</span>
        {approvalCount !== undefined && (
          <>
            <span className="dot-sep">·</span>
            <span>
              {approvalCount} approval{approvalCount === 1 ? "" : "s"}
            </span>
          </>
        )}
      </div>

      {nip.kinds.length > 0 && (
        <div className="kinds detail-kinds">
          {nip.kinds.map((kind) => (
            <span className="kind-chip" key={`${kind.kind}:${kind.name}`}>
              kind {kind.kind}
              {kind.name ? ` · ${kind.name}` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="markdown nip-page-body">
        {nip.content.trim() ? (
          <Markdown source={nip.content} />
        ) : (
          <p className="empty-inline">
            This NIP has no body content - only metadata.
          </p>
        )}
      </div>
    </>
  );
}
