import "./style.css";
import { type CSSProperties, StrictMode, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Agents, findAgent, NEW } from "@/agents";
import { useAgents } from "@/agents-store";
import { AppSidebar, NAV } from "@/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Graph } from "@/graph";
import { Home } from "@/home";
import { decodeTopic, Notes } from "@/notes";
import { ProjectHeader } from "@/project-header";
import { Search } from "@/search";

// The page lives in the URL hash (#/agents/billing, #/search?q=color), so links, Back and reload all work.
const subscribe = (onChange: () => void) => {
  addEventListener("hashchange", onChange);
  return () => removeEventListener("hashchange", onChange);
};
const useRoute = () => useSyncExternalStore(subscribe, () => location.hash.slice(1) || "/");

function App() {
  const [route, query = ""] = useRoute().split("?");
  const [, section = "", id] = route.split("/");
  const path = `/${section}`;
  const page = NAV.find((n) => n.path === path);
  const params = new URLSearchParams(query);
  const { agents } = useAgents();
  const topic = path === "/notes" ? decodeTopic(id) : undefined;
  // "_minColorDistance · Symbols · Atlas", "Investigation into billing logic · Agents · Atlas", or just "Atlas" on Home.
  const subject =
    path === "/search" || path === "/graph"
      ? params.get("name")
      : path === "/agents"
        ? id === NEW
          ? "New agent"
          : findAgent(agents, id)?.title
        : topic;
  const title = [subject, path === "/" ? undefined : (page?.title ?? "Not found"), "Atlas"].filter(Boolean).join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <SidebarProvider style={{ "--sidebar-width": "12.5rem" } as CSSProperties}>
      <AppSidebar route={path} />
      {/* Fixed height so pages like Agents scroll their own columns. */}
      <SidebarInset className="h-svh overflow-y-auto">
        <ProjectHeader />
        {path === "/" ? (
          <Home />
        ) : path === "/search" ? (
          <Search params={params} />
        ) : path === "/agents" ? (
          <Agents id={id} />
        ) : path === "/notes" ? (
          <Notes topic={topic} />
        ) : path === "/graph" ? (
          <Graph params={params} />
        ) : (
          <p className="m-auto text-muted-foreground">{page ? `${page.title} is coming soon.` : "Page not found."}</p>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
