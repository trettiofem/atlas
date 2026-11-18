import { Bot, House, type LucideIcon, Search, Waypoints } from "lucide-react";
import { AgentIcon } from "@/agent-icon";
import logo from "@/assets/Logo.svg";
import wordmark from "@/assets/LogoWordmark.svg";
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
import { AGENTS } from "@/mock";
import { useRecentSymbols } from "@/recent";
import { SymbolIcon, searchHref } from "@/symbol";

export const NAV: { path: string; title: string; icon: LucideIcon }[] = [
  { path: "/", title: "Home", icon: House },
  { path: "/search", title: "Search", icon: Search },
  { path: "/agents", title: "Agents", icon: Bot },
  { path: "/graph", title: "Code Graph", icon: Waypoints },
];

// Collapsed ("icon") mode: the mark replaces the wordmark, the trigger moves to the footer and Latest hides.
export function AppSidebar({ route }: { route: string }) {
  const symbols = useRecentSymbols();
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
          <SidebarGroupLabel>Latest</SidebarGroupLabel>
          <SidebarMenu>
            {symbols.map((s) => (
              <SidebarMenuItem key={`${s.file}:${s.line}:${s.name}`}>
                <SidebarMenuButton asChild>
                  <a href={searchHref({ q: s.name, name: s.name, file: s.file, line: s.line })} title={`${s.file}:${s.line}`}>
                    <SymbolIcon kind={s.kind} />
                    <span className="font-mono">{s.name}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            {/* shortcut: mock agents; replace once agents are tracked. */}
            {AGENTS.map((a) => (
              <SidebarMenuItem key={a.id}>
                <SidebarMenuButton asChild>
                  <a href={`#/agents/${a.id}`}>
                    <AgentIcon status={a.status} />
                    <span>{a.title}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="hidden items-center group-data-[collapsible=icon]:flex">
        <SidebarTrigger className="text-muted-foreground" />
      </SidebarFooter>
    </Sidebar>
  );
}
