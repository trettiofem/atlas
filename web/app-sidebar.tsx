import { BookSearch, Bot, House, type LucideIcon, NotebookText, Waypoints } from "lucide-react";
import { useMemo } from "react";
import { AgentIcon } from "@/agent-icon";
import { useAgents } from "@/agents-store";
import { type Agent, noteHref } from "@/api";
import logo from "@/assets/Logo.svg";
import wordmark from "@/assets/LogoWordmark.svg";
import avatar from "@/assets/UserLarge.svg";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { USER } from "@/mock";
import { RECENT_LIMIT, type RecentSymbol, useRecentAgents, useRecentNotes, useRecentSymbols } from "@/recent";
import { SymbolIcon, searchHref } from "@/symbol";

type RecentEntry = { at: number } & (
  | { type: "symbol"; symbol: RecentSymbol }
  | { type: "note"; topic: string }
  | { type: "agent"; agent: Agent }
);

/**
 * Symbols, field notes and agents in one list, the last touched first. An agent counts as touched when it was created,
 * or later when the user opened or messaged it. Entries saved before touch times existed sort last.
 */
function useRecent(): RecentEntry[] {
  const symbols = useRecentSymbols();
  const notes = useRecentNotes();
  const touchedAgents = useRecentAgents();
  const { agents } = useAgents();
  return useMemo(() => {
    const touched = new Map(touchedAgents.map((a) => [a.id, a.at ?? 0]));
    const entries: RecentEntry[] = [
      ...symbols.map((symbol) => ({ type: "symbol" as const, at: symbol.at ?? 0, symbol })),
      ...notes.map(({ topic, at }) => ({ type: "note" as const, at: at ?? 0, topic })),
      ...agents.map((agent) => ({ type: "agent" as const, at: Math.max(touched.get(agent.id) ?? 0, agent.createdAt), agent })),
    ];
    return entries.sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT);
  }, [symbols, notes, touchedAgents, agents]);
}

export const NAV: { path: string; title: string; icon: LucideIcon }[] = [
  { path: "/", title: "Home", icon: House },
  { path: "/agents", title: "Agents", icon: Bot },
  { path: "/notes", title: "Field notes", icon: NotebookText },
  { path: "/search", title: "Symbols", icon: BookSearch },
  { path: "/graph", title: "Code Graph", icon: Waypoints },
];

// Collapsed ("icon") mode: the mark replaces the wordmark, the trigger moves to the footer and Recent hides.
export function AppSidebar({ route }: { route: string }) {
  const recent = useRecent();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
        <a href="#/" className="flex h-7 items-center">
          <img src={wordmark} alt="Atlas" width={72} height={18} className="group-data-[collapsible=icon]:hidden" />
          <img src={logo} alt="Atlas" width={26} height={18} className="hidden group-data-[collapsible=icon]:block" />
        </a>
        <SidebarTrigger className="-mr-1.5 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map(({ path, title, icon: Icon }) => (
              <SidebarMenuItem key={path}>
                <SidebarMenuButton asChild tooltip={title} isActive={route === path}>
                  <a href={`#${path}`} aria-current={route === path ? "page" : undefined}>
                    <Icon className="text-muted-foreground" />
                    <span>{title}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarMenu>
            {recent.map((r) =>
              r.type === "symbol" ? (
                <SidebarMenuItem key={`symbol:${r.symbol.file}:${r.symbol.line}:${r.symbol.name}`}>
                  <SidebarMenuButton asChild>
                    <a
                      href={searchHref({ q: r.symbol.name, name: r.symbol.name, file: r.symbol.file, line: r.symbol.line })}
                      title={`${r.symbol.file}:${r.symbol.line}`}
                    >
                      <SymbolIcon kind={r.symbol.kind} />
                      <span className="font-mono">{r.symbol.name}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : r.type === "note" ? (
                <SidebarMenuItem key={`note:${r.topic}`}>
                  <SidebarMenuButton asChild>
                    <a href={noteHref(r.topic)} title={r.topic}>
                      <NotebookText className="text-muted-foreground" />
                      <span>{r.topic}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                <SidebarMenuItem key={`agent:${r.agent.id}`}>
                  <SidebarMenuButton asChild>
                    <a href={`#/agents/${r.agent.id}`}>
                      <AgentIcon status={r.agent.status} />
                      {r.agent.named ? (
                        <span>{r.agent.title}</span>
                      ) : (
                        <>
                          <Skeleton aria-hidden className="h-3.5 flex-1 bg-border" />
                          <span className="sr-only">{r.agent.title}</span>
                        </>
                      )}
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ),
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-4 p-4 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
        <div className="flex items-center gap-2" title={`${USER.name} · ${USER.org}`}>
          <img src={avatar} alt="" width={24} height={24} className="shrink-0" />
          <div className="min-w-0 group-data-[collapsible=icon]:sr-only">
            <div className="truncate font-medium">{USER.name}</div>
            <div className="truncate text-muted-foreground">{USER.org}</div>
          </div>
        </div>
        <SidebarTrigger className="hidden text-muted-foreground group-data-[collapsible=icon]:flex" />
      </SidebarFooter>
    </Sidebar>
  );
}
