import { useEffect, useState } from "react";

export type Route =
  | { name: "feed" }
  | { name: "settings" }
  | { name: "new" }
  | { name: "edit"; id: string }
  | { name: "nip"; id: string };

function parse(hash: string): Route {
  // Strip leading "#" and an optional leading "/".
  const path = hash.replace(/^#\/?/, "");
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
  return `#/nip/${encodeURIComponent(id)}`;
}

/** Build the URL for editing a NIP you authored, given its naddr/identifier. */
export function editHref(id: string): string {
  return `#/edit/${encodeURIComponent(id)}`;
}

/** Minimal hash-based router — shareable URLs, working Back button, no deps. */
export function useHashRoute(): {
  route: Route;
  navigate: (hash: string) => void;
} {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (hash: string) => {
    if (location.hash === hash) return;
    location.hash = hash;
    // Scroll to top on navigation (route changes are full-screen swaps).
    window.scrollTo(0, 0);
  };

  return { route, navigate };
}
