import { useRoute } from "./lib/router";
import { HomePage } from "./pages/Home";
import { PairPage } from "./pages/Pair";
import { SessionPage } from "./pages/Session";
import { HostsPage } from "./pages/Hosts";

export function App() {
  const [route, navigate] = useRoute();

  if (route.name === "pair") {
    return (
      <PairPage
        token={route.token}
        onConnected={(t) => navigate({ name: "session", tab: "overview", sessionToken: t })}
        onCancel={() => navigate({ name: "home" })}
      />
    );
  }
  if (route.name === "session") {
    if (!route.sessionToken) {
      navigate({ name: "home" });
      return null;
    }
    return (
      <SessionPage
        sessionToken={route.sessionToken}
        tab={route.tab}
        onTabChange={(tab) => navigate({ name: "session", tab, sessionToken: route.sessionToken })}
        onDisconnected={() => navigate({ name: "home" })}
      />
    );
  }
  if (route.name === "hosts") {
    return <HostsPage onBack={() => navigate({ name: "home" })} />;
  }
  return <HomePage />;
}
