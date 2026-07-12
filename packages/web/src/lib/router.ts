import { useEffect, useState } from "react";

export type Tab = "overview" | "terminal" | "files" | "git" | "desktop" | "chat" | "proxy" | "ops" | "agents" | "audit";
export type Route =
  | { name: "home" }
  | { name: "pair"; token: string | null }
  | { name: "session"; tab: Tab; sessionToken: string }
  | { name: "hosts" };

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  const pageParams = new URLSearchParams(window.location.search || "");
  const directSessionToken = pageParams.get("session");
  if (directSessionToken && !path) {
    return { name: "session", tab: "overview", sessionToken: directSessionToken };
  }
  if (path === "pair") return { name: "pair", token: params.get("token") };
  if (path === "hosts") return { name: "hosts" };
  if (path === "overview" || path === "terminal" || path === "files" || path === "git" || path === "desktop" || path === "chat" || path === "proxy" || path === "ops" || path === "agents" || path === "audit" || path === "session") {
    const sessionToken = params.get("token") || pageParams.get("session") || sessionStorage.getItem("lawang:session") || "";
    const tab: Tab =
      path === "overview" || path === "session" ? "overview" :
      path === "files" ? "files" :
      path === "git" ? "git" :
      path === "desktop" ? "desktop" :
      path === "chat" ? "chat" :
      path === "proxy" ? "proxy" :
      path === "ops" ? "ops" :
      path === "agents" ? "agents" :
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
      else if (r.name === "hosts") window.location.hash = "/hosts";
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
