import { useCallback, useEffect, useRef, useState } from "react";
import type { LoginTab } from "@formstr/signer/ui";
import { signer, pool } from "../nostr/bootstrap";
import { APP_NAME, APP_URL } from "../nostr/constants";
import { toast } from "../lib/toast";
import { QRCodeSVG } from "qrcode.react";

type Section = "bunker" | "qr" | "ncryptsec" | "create" | null;

// Permissions requested when pairing a NIP-46 remote signer. Amber wants
// explicit `sign_event:<kind>` entries or it can fail-closed before showing
// the approve screen; `get_public_key` is needed for the handshake.
const NOSTRCONNECT_PERMS = [
  "get_public_key",
  "sign_event:0",
  "sign_event:1",
  "sign_event:5",
  "sign_event:7",
  "sign_event:1111",
  "sign_event:1985",
  "sign_event:9734",
  "sign_event:30817",
];

function shortNpub(npub: string): string {
  return npub.length > 16 ? `${npub.slice(0, 10)}…${npub.slice(-4)}` : npub;
}

function sectionForTab(tab?: LoginTab): Section {
  switch (tab) {
    case "ncryptsec":
      return "ncryptsec";
    case "bunker":
      return "bunker";
    case "nostrconnect":
      return "qr";
    case "create":
      return "create";
    default:
      return null;
  }
}

/**
 * The login modal — a pollerama-style vertical list of sign-in options, each
 * an icon-badged row that expands its own inline form. Drives the signer
 * package's programmatic API directly (no Android / NIP-55: this is a website).
 */
export function LoginModal({
  open,
  initialTab,
  onClose,
}: {
  open: boolean;
  initialTab?: LoginTab;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<Section>(null);
  const [bunkerUri, setBunkerUri] = useState("");
  const [ncryptsec, setNcryptsec] = useState("");
  const [ncryptsecPass, setNcryptsecPass] = useState("");
  // The npub of a saved (locked) ncryptsec account, so we can prefill its key
  // and ask only for the passphrase. `showKeyField` reveals the raw textarea
  // when the user wants to paste a different key.
  const [savedNpub, setSavedNpub] = useState<string | null>(null);
  const [showKeyField, setShowKeyField] = useState(true);
  const passRef = useRef<HTMLInputElement>(null);
  const [createPass, setCreatePass] = useState("");
  const [createdSec, setCreatedSec] = useState<string | null>(null);
  const [savedAck, setSavedAck] = useState(false);
  const [qrRelays, setQrRelays] = useState("wss://relay.nsec.app");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const qrAbort = useRef<AbortController | null>(null);

  const hasExtension =
    typeof window !== "undefined" && "nostr" in window;

  // Synchronous capability check: an Android browser with clipboard access,
  // and not inside a native shell. False on desktop, so the row is hidden.
  const canUseNip55Web = signer.supportsNip55Web();

  const reset = useCallback(() => {
    qrAbort.current?.abort();
    qrAbort.current = null;
    setExpanded(null);
    setBunkerUri("");
    setNcryptsec("");
    setNcryptsecPass("");
    setCreatePass("");
    setCreatedSec(null);
    setSavedAck(false);
    setSavedNpub(null);
    setShowKeyField(true);
    setQrUri(null);
    setBusy(false);
    setError("");
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    // If the active account is a saved (locked) ncryptsec, prefill its key so
    // unlocking only needs the passphrase.
    const active = signer.getActiveAccount();
    const stored =
      active?.method === "ncryptsec" ? active.ncryptsec : undefined;
    const locked = !signer.getActiveSigner();
    if (stored) {
      setNcryptsec(stored);
      setSavedNpub(active?.npub ?? null);
      setShowKeyField(false);
    }
    setExpanded(
      sectionForTab(initialTab) ?? (stored && locked ? "ncryptsec" : null),
    );
  }, [open, initialTab, reset]);

  // Focus the passphrase field whenever the ncryptsec section is open — the
  // common case is unlocking a saved key, where that's the only thing to type.
  useEffect(() => {
    if (open && expanded === "ncryptsec") {
      const t = setTimeout(() => passRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open, expanded]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const finish = (npub: string) => {
    toast.success(`Signed in as ${shortNpub(npub)}.`);
    onClose();
  };

  const toggle = (section: Exclude<Section, null>) => {
    setError("");
    if (section !== "qr") {
      qrAbort.current?.abort();
      qrAbort.current = null;
      setQrUri(null);
    }
    setExpanded((prev) => (prev === section ? null : section));
  };

  const guard = async (fn: () => Promise<{ npub: string }>) => {
    setBusy(true);
    setError("");
    try {
      const account = await fn();
      finish(account.npub);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const onExtension = () =>
    guard(() => signer.loginWithExtension());

  const onNip55Web = () =>
    guard(() => signer.loginWithNip55Web());

  const onBunker = () =>
    guard(() => signer.loginWithBunkerUri(bunkerUri.trim(), { pool }));

  const onNcryptsec = () =>
    guard(() => signer.loginWithNcryptsec(ncryptsec.trim(), ncryptsecPass));

  const onCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const { ncryptsec } = await signer.createAccount(createPass);
      // The account is already active; surface the ncryptsec for backup before
      // closing — it's the only way back in on a fresh device.
      setCreatedSec(ncryptsec);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create account.");
    } finally {
      setBusy(false);
    }
  };

  const onStartQr = async () => {
    const relays = qrRelays.split(",").map((s) => s.trim()).filter(Boolean);
    if (relays.length === 0) {
      setError("At least one relay is required.");
      return;
    }
    setError("");
    setQrUri(null);
    const abort = new AbortController();
    qrAbort.current = abort;
    try {
      const account = await signer.loginWithNostrConnect({
        relays,
        pool,
        perms: NOSTRCONNECT_PERMS,
        metadata: { name: APP_NAME, url: APP_URL },
        signal: abort.signal,
        onUri: (uri) => setQrUri(uri),
      });
      finish(account.npub);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name !== "AbortError") {
        setError(e?.message ?? "Remote signer pairing failed.");
      }
      setQrUri(null);
    } finally {
      qrAbort.current = null;
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${what}.`);
    } catch {
      toast.error("Couldn't access the clipboard.");
    }
  };

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="sheet login-sheet"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
      >
        <div className="login-header">
          <div className="login-badge" aria-hidden>
            🔑
          </div>
          <h2 className="login-title">Sign in</h2>
          <p className="login-sub">Choose how to access {APP_NAME}</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="login-options">
          {hasExtension && (
            <OptionRow
              icon="🧩"
              title="Browser extension"
              desc="Alby, nos2x, Flamingo…"
              onClick={onExtension}
              disabled={busy}
            />
          )}

          {/* Browser NIP-55: an Android signer app reached from the browser.
              supportsNip55Web() is false on desktop, so this stays hidden. */}
          {canUseNip55Web && (
            <OptionRow
              icon="📱"
              title="Signer app"
              desc="Amber or another NIP-55 app on this device"
              onClick={onNip55Web}
              disabled={busy}
            />
          )}

          <div className="login-opt-wrap">
            <OptionRow
              icon="🔌"
              title="Nostr bunker"
              desc="Connect via a NIP-46 bunker URI"
              onClick={() => toggle("bunker")}
              expanded={expanded === "bunker"}
            />
            {expanded === "bunker" && (
              <div className="login-panel">
                <input
                  className="search"
                  placeholder="bunker://…"
                  value={bunkerUri}
                  onChange={(e) => setBunkerUri(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onBunker()}
                />
                <button
                  className="btn"
                  onClick={onBunker}
                  disabled={!bunkerUri.trim() || busy}
                >
                  {busy ? "Connecting…" : "Connect"}
                </button>
              </div>
            )}
          </div>

          <div className="login-opt-wrap">
            <OptionRow
              icon="📱"
              title="Remote signer (QR)"
              desc="Pair a mobile signer via nostrconnect"
              onClick={() => toggle("qr")}
              expanded={expanded === "qr"}
            />
            {expanded === "qr" && (
              <div className="login-panel col">
                {!qrUri ? (
                  <>
                    <input
                      className="search"
                      placeholder="Relays (comma-separated)"
                      value={qrRelays}
                      onChange={(e) => setQrRelays(e.target.value)}
                    />
                    <button
                      className="btn"
                      onClick={onStartQr}
                      disabled={!qrRelays.trim()}
                    >
                      Generate QR
                    </button>
                  </>
                ) : (
                  <div className="login-qr">
                    <div className="zap-qr">
                      <QRCodeSVG value={qrUri} size={210} level="M" />
                    </div>
                    <p className="login-hint">
                      Scan with your signer. Waiting for pairing…
                    </p>
                    <div className="login-qr-actions">
                      <button
                        className="btn ghost"
                        onClick={() => void copy(qrUri, "nostrconnect URI")}
                      >
                        Copy URI
                      </button>
                      <button
                        className="btn ghost"
                        onClick={() => {
                          qrAbort.current?.abort();
                          qrAbort.current = null;
                          setQrUri(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="login-opt-wrap">
            <OptionRow
              icon="🔐"
              title="Existing key"
              desc="Sign in with an encrypted nsec (ncryptsec)"
              onClick={() => toggle("ncryptsec")}
              expanded={expanded === "ncryptsec"}
            />
            {expanded === "ncryptsec" && (
              <div className="login-panel col">
                {savedNpub && !showKeyField ? (
                  <div className="login-saved-key">
                    <span>
                      Saved key · <span className="mono">{shortNpub(savedNpub)}</span>
                    </span>
                    <button
                      className="link-btn"
                      onClick={() => {
                        setShowKeyField(true);
                        setNcryptsec("");
                      }}
                    >
                      Use a different key
                    </button>
                  </div>
                ) : (
                  <textarea
                    className="comment-input"
                    rows={2}
                    placeholder="ncryptsec1…"
                    value={ncryptsec}
                    onChange={(e) => setNcryptsec(e.target.value)}
                  />
                )}
                <input
                  ref={passRef}
                  className="search"
                  type="password"
                  placeholder="Passphrase"
                  value={ncryptsecPass}
                  onChange={(e) => setNcryptsecPass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onNcryptsec()}
                />
                <button
                  className="btn"
                  onClick={onNcryptsec}
                  disabled={!ncryptsec.trim() || !ncryptsecPass || busy}
                >
                  {busy ? "Unlocking…" : "Sign in"}
                </button>
              </div>
            )}
          </div>

          <div className="login-opt-wrap">
            <OptionRow
              icon="✨"
              title="Create a new account"
              desc="Generate a key, encrypted at rest"
              onClick={() => toggle("create")}
              expanded={expanded === "create"}
            />
            {expanded === "create" && (
              <div className="login-panel col">
                {!createdSec ? (
                  <>
                    <input
                      className="search"
                      type="password"
                      placeholder="Choose a passphrase"
                      value={createPass}
                      onChange={(e) => setCreatePass(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && onCreate()}
                    />
                    <p className="login-hint">
                      Encrypts your key (NIP-49). You'll need this passphrase to
                      unlock on every visit — there's no recovery.
                    </p>
                    <button
                      className="btn"
                      onClick={() => void onCreate()}
                      disabled={!createPass || busy}
                    >
                      {busy ? "Generating…" : "Create account"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="login-hint warn">
                      Save this <strong>ncryptsec</strong> somewhere safe — it's
                      the only way back into this account on another device.
                    </p>
                    <textarea
                      className="comment-input mono-input"
                      rows={3}
                      readOnly
                      value={createdSec}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <div className="login-qr-actions">
                      <button
                        className="btn ghost"
                        onClick={() => void copy(createdSec, "ncryptsec")}
                      >
                        Copy ncryptsec
                      </button>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={savedAck}
                        onChange={(e) => setSavedAck(e.target.checked)}
                      />
                      I've saved my ncryptsec
                    </label>
                    <button
                      className="btn"
                      onClick={onClose}
                      disabled={!savedAck}
                    >
                      Continue
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <button className="btn ghost login-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function OptionRow({
  icon,
  title,
  desc,
  onClick,
  disabled,
  expanded,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      className={`login-opt${expanded ? " open" : ""}`}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      <span className="login-opt-icon" aria-hidden>
        {icon}
      </span>
      <span className="login-opt-text">
        <span className="login-opt-title">{title}</span>
        <span className="login-opt-desc">{desc}</span>
      </span>
      <span className={`login-opt-chev${expanded ? " rot" : ""}`} aria-hidden>
        ›
      </span>
    </button>
  );
}
