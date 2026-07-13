import { useCallback, useMemo, useState } from "react";
import type { LoginTab } from "@formstr/signer/ui";
import { LoginBar } from "./components/LoginBar";
import { ScopeTabs } from "./components/ScopeTabs";
import { NipFeed } from "./components/NipFeed";
import { NipPage } from "./components/NipPage";
import { ComposeNip } from "./components/ComposeNip";
import { Settings } from "./components/Settings";
import { AppsPage } from "./components/AppsPage";
import { NotificationsPage } from "./components/NotificationsPage";
import { LoginModal } from "./components/LoginModal";
import { Toaster } from "./components/Toaster";
import { useSigner } from "./hooks/useSigner";
import { useFollows, type Surface } from "./hooks/useNips";
import { useNotifications } from "./hooks/useNotifications";
import { useWebOfTrust } from "./hooks/useWebOfTrust";
import { useUserRelays } from "./hooks/useUserRelays";
import { editHref, nipHref, useRoute } from "./hooks/useRoute";

export default function App() {
  const { pubkey, locked, method } = useSigner();
  const { route, navigate } = useRoute();
  const [surface, setSurface] = useState<Surface>("following");
  const [login, setLogin] = useState<{ open: boolean; tab?: LoginTab }>({
    open: false,
  });

  const follows = useFollows(pubkey);
  const wot = useWebOfTrust(pubkey, follows);
  const userRelays = useUserRelays(pubkey);
  const notifications = useNotifications(pubkey);

  const openLogin = useCallback((tab?: LoginTab) => {
    setLogin({ open: true, tab });
  }, []);
  const closeLogin = useCallback(() => setLogin({ open: false }), []);

  // Trust-scoped surfaces need a logged-in user with follows.
  const disabled = useMemo(() => {
    const set = new Set<Surface>();
    if (!pubkey || follows.length === 0) {
      set.add("following");
      set.add("web-of-trust");
    }
    return set;
  }, [pubkey, follows.length]);

  // Fall back to Global when the active surface is unavailable.
  const effective: Surface = disabled.has(surface) ? "global" : surface;

  return (
    <div className="app">
      <LoginBar
        onOpenLogin={() => openLogin()}
        onNavigateHome={() => navigate("/")}
        onNavigateSettings={() => navigate("/settings")}
        onNavigateApps={() => navigate("/apps")}
        onNavigateNotifications={() => navigate("/notifications")}
        unreadNotifications={notifications.unread}
      />

      {locked && (
        <div className="lock-banner">
          <span>
            Your {method === "ncryptsec" ? "encrypted key" : "session"} is
            locked — re-authenticate to approve NIPs.
          </span>
          <button
            className="btn sm"
            onClick={() =>
              openLogin(method === "ncryptsec" ? "ncryptsec" : undefined)
            }
          >
            Unlock
          </button>
        </div>
      )}

      <main className="content">
        {route.name === "nip" ? (
          <NipPage
            id={route.id}
            follows={follows}
            webOfTrust={wot.set}
            onNeedsAuth={() => openLogin()}
            onBack={() => navigate("/")}
            onEdit={() => navigate(editHref(route.id))}
            onDeleted={() => navigate("/")}
          />
        ) : route.name === "edit" ? (
          <ComposeNip
            loggedIn={!!pubkey}
            editId={route.id}
            onNeedsAuth={() => openLogin()}
            onBack={() => navigate(nipHref(route.id))}
            onPublished={(naddr) => navigate(nipHref(naddr))}
          />
        ) : route.name === "settings" ? (
          <Settings
            pubkey={pubkey}
            wot={wot}
            userRelays={userRelays}
            onOpenLogin={() => openLogin()}
            onBack={() => navigate("/")}
          />
        ) : route.name === "apps" ? (
          <AppsPage
            follows={follows}
            webOfTrust={wot.set}
            loggedIn={!!pubkey}
            onBack={() => navigate("/")}
          />
        ) : route.name === "notifications" ? (
          <NotificationsPage
            pubkey={pubkey}
            notifications={notifications}
            onOpenNip={(id) => navigate(nipHref(id))}
            onBack={() => navigate("/")}
          />
        ) : route.name === "new" ? (
          <ComposeNip
            loggedIn={!!pubkey}
            onNeedsAuth={() => openLogin()}
            onBack={() => navigate("/")}
            onPublished={(naddr) => navigate(nipHref(naddr))}
          />
        ) : (
          <>
            <div className="feed-head">
              <ScopeTabs
                surface={effective}
                onChange={setSurface}
                disabled={disabled}
              />
              <button className="btn new-nip" onClick={() => navigate("/new")}>
                + New NIP
              </button>
            </div>
            <NipFeed
              surface={effective}
              pubkey={pubkey}
              follows={follows}
              webOfTrust={wot.set}
              onOpenNip={(id) => navigate(nipHref(id))}
              onNeedsAuth={() => openLogin()}
            />
          </>
        )}
      </main>

      <LoginModal
        open={login.open}
        initialTab={login.tab}
        onClose={closeLogin}
      />
      <Toaster />
    </div>
  );
}
