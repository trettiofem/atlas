import "./style.css";
import { type CSSProperties, StrictMode, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Agents, findAgent } from "@/agents";
import { AppSidebar, NAV } from "@/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Home } from "@/home";
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
  // "_minColorDistance · Search · Atlas", "Investigation into billing logic · Agents · Atlas", or just "Atlas" on Home.
  const subject = path === "/search" ? params.get("name") : path === "/agents" ? findAgent(id)?.title : undefined;
  const title = [subject, path === "/" ? undefined : (page?.title ?? "Not found"), "Atlas"].filter(Boolean).join(" · ");
  useEffect(() => {
    document.title = title;
  }, [title]);
  return (
    <SidebarProvider style={{ "--sidebar-width": "12.5rem" } as CSSProperties}>
      <AppSidebar route={path} />
      {/* Fixed height so pages like Agents scroll their own columns. */}
      <SidebarInset className="h-svh overflow-y-auto">
        {/* On mobile the sidebar is a sheet, so it needs an opener outside itself. */}
        <SidebarTrigger className="m-2 shrink-0 text-muted-foreground md:hidden" />
        {path === "/" ? (
          <Home />
        ) : path === "/search" ? (
          <Search params={params} />
        ) : path === "/agents" ? (
          <Agents id={id} />
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
