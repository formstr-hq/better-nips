import { useEffect, useRef, useState } from "react";
import { npubEncode } from "nostr-tools/nip19";
import { useSigner } from "../hooks/useSigner";
import { useProfile } from "../hooks/useNips";
import { APP_NAME, APP_TAGLINE } from "../nostr/constants";
import { OnlineDot } from "./OnlineDot";
import { BrandMark } from "./BrandMark";

function shortNpub(pubkey: string): string {
  try {
    const npub = npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return pubkey.slice(0, 10);
  }
}

export function LoginBar({
  onOpenLogin,
  onNavigateHome,
  onNavigateSettings,
  onNavigateApps,
  onNavigateNotifications,
  unreadNotifications = 0,
}: {
  onOpenLogin: () => void;
  onNavigateHome: () => void;
  onNavigateSettings: () => void;
  onNavigateApps: () => void;
  onNavigateNotifications: () => void;
  unreadNotifications?: number;
}) {
  const { pubkey, loggedIn, locked, accounts, switchAccount, logout } =
    useSigner();
  const profile = useProfile(pubkey);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const name = profile?.name || (pubkey ? shortNpub(pubkey) : "");

  return (
    <header className="topbar">
      <button className="brand" onClick={onNavigateHome} title={APP_TAGLINE}>
        <BrandMark />
        <span className="brand-text">
          <span className="brand-name">{APP_NAME}</span>
          <span className="brand-sub">{APP_TAGLINE}</span>
        </span>
      </button>

      <div className="account">
        <OnlineDot />
        {loggedIn && pubkey && (
          <button
            className="notif-bell"
            onClick={onNavigateNotifications}
            title="Notifications"
            aria-label={
              unreadNotifications > 0
                ? `Notifications (${unreadNotifications} unread)`
                : "Notifications"
            }
          >
            🔔
            {unreadNotifications > 0 && (
              <span className="notif-badge">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </button>
        )}
        {loggedIn && pubkey ? (
          <div className="menu-wrap" ref={menuRef}>
            <button
              className={`profile-btn${locked ? " locked" : ""}`}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {profile?.picture ? (
                <img className="avatar sm" src={profile.picture} alt="" />
              ) : (
                <div className="avatar sm placeholder" />
              )}
              <span className="profile-name">{name}</span>
              {locked && <span className="lock-badge" title="Locked">🔒</span>}
            </button>

            {menuOpen && (
              <div className="menu">
                {locked && (
                  <button
                    className="menu-item warn"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenLogin();
                    }}
                  >
                    Re-authenticate to sign
                  </button>
                )}
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigateApps();
                  }}
                >
                  App directory
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigateSettings();
                  }}
                >
                  Settings & web of trust
                </button>

                {accounts.length > 1 && (
                  <>
                    <div className="menu-label">Switch account</div>
                    {accounts
                      .filter((a) => a.pubkey !== pubkey)
                      .map((a) => (
                        <button
                          key={a.pubkey}
                          className="menu-item account-row"
                          onClick={() => {
                            setMenuOpen(false);
                            void switchAccount(a.pubkey);
                          }}
                        >
                          <span className="mono">{shortNpub(a.pubkey)}</span>
                          <span className="method-tag">{a.method}</span>
                        </button>
                      ))}
                  </>
                )}

                <div className="menu-divider" />
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenLogin();
                  }}
                >
                  Add another account
                </button>
                <button
                  className="menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    void logout();
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="btn" onClick={onOpenLogin}>
            Connect
          </button>
        )}
      </div>
    </header>
  );
}
