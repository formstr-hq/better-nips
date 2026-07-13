import { useEffect, useState } from "react";

export type Route =
  | { name: "feed" }
  | { name: "settings" }
  | { name: "new" }
  | { name: "edit"; id: string }
  | { name: "nip"; id: string };

function parse(pathname: string): Route {
  // Strip leading/trailing slashes so "/nip/x" and "nip/x/" both match.
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (path === "settings") return { name: "settings" };
  if (path === "new") return { name: "new" };
  const edit = path.match(/^edit\/(.+)$/);
  if (edit) return { name: "edit", id: decodeURIComponent(edit[1]) };
  const nip = path.match(/^nip\/(.+)$/);
  if (nip) return { name: "nip", id: decodeURIComponent(nip[1]) };
  return { name: "feed" };
}

/** Build a shareable URL for a NIP screen, given its naddr/identifier. */
export function nipHref(id: string): string {
  return `/nip/${encodeURIComponent(id)}`;
}

/** Build the URL for editing a NIP you authored, given its naddr/identifier. */
export function editHref(id: string): string {
  return `/edit/${encodeURIComponent(id)}`;
}

/** Minimal History-API router — real paths, working Back button, no deps. */
export function useRoute(): {
  route: Route;
  navigate: (path: string) => void;
} {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));

  useEffect(() => {
    // popstate fires on Back/Forward; pushState (in navigate) does not, so we
    // also set the route synchronously there.
    const onPop = () => setRoute(parse(location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (path: string) => {
    if (location.pathname === path) return;
    history.pushState(null, "", path);
    setRoute(parse(path));
    // Scroll to top on navigation (route changes are full-screen swaps).
    window.scrollTo(0, 0);
  };

  return { route, navigate };
}
