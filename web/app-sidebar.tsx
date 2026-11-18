import { Bot, File, House, type LucideIcon, Search, Waypoints } from "lucide-react";
import { AgentIcon, type AgentStatus } from "@/agent-icon";
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
import { cn } from "@/lib/utils";
import { AGENTS } from "@/mock";

export const NAV: { path: string; title: string; icon: LucideIcon }[] = [
  { path: "/", title: "Home", icon: House },
  { path: "/search", title: "Search", icon: Search },
  { path: "/agents", title: "Agents", icon: Bot },
  { path: "/graph", title: "Code Graph", icon: Waypoints },
];

type Recent = { kind: "symbol"; name: string; href: string } | { kind: "agent"; title: string; status: AgentStatus; href: string };

// shortcut: mock data; replace when recently used symbols and agents are tracked.
const LATEST: Recent[] = [
  { kind: "symbol", name: "_minColorDistance", href: "#/search" },
  ...AGENTS.map((a) => ({ kind: "agent" as const, title: a.title, status: a.status, href: `#/agents/${a.id}` })),
];

// Collapsed ("icon") mode: the mark replaces the wordmark, the trigger moves to the footer and Latest hides.
export function AppSidebar({ route }: { route: string }) {
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
            {LATEST.map((item, i) => (
              <SidebarMenuItem key={i}>
                <SidebarMenuButton asChild>
                  <a href={item.href}>
                    {item.kind === "symbol" ? <File className="text-muted-foreground" /> : <AgentIcon status={item.status} />}
                    <span className={cn(item.kind === "symbol" && "font-mono")}>
                      {item.kind === "symbol" ? item.name : item.title}
                    </span>
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
