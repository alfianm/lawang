import { useEffect, useState } from "react";

export type Tab = "terminal" | "files" | "git" | "chat" | "proxy" | "audit";
export type Route =
  | { name: "home" }
  | { name: "pair"; token: string | null }
  | { name: "session"; tab: Tab; sessionToken: string };

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  if (path === "pair") return { name: "pair", token: params.get("token") };
  if (path === "terminal" || path === "files" || path === "git" || path === "chat" || path === "proxy" || path === "audit" || path === "session") {
    const sessionToken = sessionStorage.getItem("lawang:session") || "";
    const tab: Tab =
      path === "files" ? "files" :
      path === "git" ? "git" :
      path === "chat" ? "chat" :
      path === "proxy" ? "proxy" :
      path === "audit" ? "audit" :
      "terminal";
    return { name: "session", tab, sessionToken };
  }
  return { name: "home" };
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse());
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [
    route,
    (r) => {
      if (r.name === "home") window.location.hash = "";
      else if (r.name === "pair") {
        const q = r.token ? `?token=${encodeURIComponent(r.token)}` : "";
        window.location.hash = `/pair${q}`;
      } else {
        sessionStorage.setItem("lawang:session", r.sessionToken);
        window.location.hash = `/${r.tab}`;
      }
    },
  ];
}
