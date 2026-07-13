import { useEffect, useMemo } from "react";
import type { Filter } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";
import type {
  NotificationItem,
  Notifications,
  NotificationType,
} from "../hooks/useNotifications";
import { useProfiles } from "../hooks/useNips";
import { useObserve } from "../hooks/useObserve";
import { KIND_NIP } from "../nostr/constants";
import { addressToNaddr, parseNip } from "../nostr/nips";
import type { Profile } from "../hooks/useNips";
import { ProfileLink } from "./ProfileLink";

function authorLabel(pubkey: string, profile?: Profile): string {
  if (profile?.name) return profile.name;
  try {
    return `${npubEncode(pubkey).slice(0, 12)}…`;
  } catch {
    return pubkey.slice(0, 12);
  }
}

function relativeTime(unixSeconds: number): string {
  const mins = (Date.now() - unixSeconds * 1000) / 60000;
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

const VERB: Record<NotificationType, string> = {
  comment: "commented on",
  approval: "approved",
  disapproval: "disapproved",
};

const ICON: Record<NotificationType, string> = {
  comment: "💬",
  approval: "✓",
  disapproval: "✕",
};

export function NotificationsPage({
  pubkey,
  notifications,
  onOpenNip,
  onBack,
}: {
  pubkey: string | null;
  notifications: Notifications;
  onOpenNip: (id: string) => void;
  onBack: () => void;
}) {
  const { items, markAllRead } = notifications;

  // Mark everything read on view — the badge clears once you've looked.
  useEffect(() => {
    if (pubkey) markAllRead();
  }, [pubkey, markAllRead]);

  // Actor profiles + the titles of the NIPs that were acted on.
  const actors = useMemo(
    () => [...new Set(items.map((n) => n.pubkey))],
    [items],
  );
  const profiles = useProfiles(actors);

  const nipFilters = useMemo<Filter[] | null>(() => {
    const authors = new Set<string>();
    const ds = new Set<string>();
    for (const n of items) {
      const [, pk, ...rest] = n.nipAddress.split(":");
      if (pk) authors.add(pk);
      const d = rest.join(":");
      if (d) ds.add(d);
    }
    if (authors.size === 0) return null;
    return [{ kinds: [KIND_NIP], authors: [...authors], "#d": [...ds] }];
  }, [items]);
  const { events: nipEvents } = useObserve(nipFilters);
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of nipEvents) {
      const nip = parseNip(e);
      if (nip) map.set(nip.address, nip.title);
    }
    return map;
  }, [nipEvents]);

  if (!pubkey) {
    return (
      <div className="notif-page">
        <button className="link-btn back" onClick={onBack}>
          ← Back
        </button>
        <p className="empty">Connect a Nostr signer to see your notifications.</p>
      </div>
    );
  }

  return (
    <div className="notif-page">
      <div className="page-head">
        <button className="link-btn back" onClick={onBack}>
          ← Back
        </button>
        <h1 className="page-title">Notifications</h1>
      </div>

      {items.length === 0 ? (
        <p className="empty">
          No notifications yet — you'll hear when someone comments on or approves
          your NIPs.
        </p>
      ) : (
        <ul className="notif-list">
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              item={n}
              profile={profiles.get(n.pubkey)}
              title={titles.get(n.nipAddress)}
              onOpen={() => onOpenNip(addressToNaddr(n.nipAddress))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  profile,
  title,
  onOpen,
}: {
  item: NotificationItem;
  profile?: Profile;
  title?: string;
  onOpen: () => void;
}) {
  return (
    <li className={`notif-row ${item.type}`}>
      <button className="notif-open" onClick={onOpen}>
        <span className={`notif-icon ${item.type}`}>{ICON[item.type]}</span>
        <span className="notif-body">
          <span className="notif-line">
            <ProfileLink pubkey={item.pubkey} className="notif-actor">
              {profile?.picture ? (
                <img className="avatar xs" src={profile.picture} alt="" />
              ) : (
                <span className="avatar xs placeholder" />
              )}
              <strong>{authorLabel(item.pubkey, profile)}</strong>
            </ProfileLink>{" "}
            {VERB[item.type]} <span className="notif-nip">{title ?? "your NIP"}</span>
          </span>
          {item.content && (
            <span className="notif-quote">{item.content}</span>
          )}
          <span className="notif-time">{relativeTime(item.createdAt)}</span>
        </span>
      </button>
    </li>
  );
}
