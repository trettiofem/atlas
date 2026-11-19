import { ChevronsUpDown, FolderGit2, GitBranch } from "lucide-react";
import { type Overview, overviewCounts, useApi } from "@/api";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PROJECT } from "@/mock";

/** The code base every page works on, so prompts and searches aren't aimed at the wrong one. */
export function ProjectHeader() {
  const overview = useApi<Overview>("/api/overview");
  const counts = overview.data && overviewCounts(overview.data);
  return (
    <header className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
      {/* On mobile the sidebar is a sheet, so it needs an opener outside itself. */}
      <SidebarTrigger className="text-muted-foreground md:hidden" />
      {/* shortcut: the switchers don't open yet; the repo and branch are mock data. */}
      <Button variant="ghost" size="sm" className="min-w-0 font-mono text-xs font-normal" title={overview.data?.project.root}>
        <FolderGit2 className="text-muted-foreground" />
        <span className="truncate">{PROJECT.repo}</span>
        <ChevronsUpDown className="text-muted-foreground" />
      </Button>
      <Button variant="ghost" size="sm" className="min-w-0 font-mono text-xs font-normal">
        <GitBranch className="text-muted-foreground" />
        <span className="truncate">{PROJECT.branch}</span>
        <ChevronsUpDown className="text-muted-foreground" />
      </Button>
      <span className="ml-auto hidden shrink-0 px-2 text-muted-foreground sm:block">
        {overview.error
          ? overview.error.notLoaded
            ? "No graph loaded."
            : "Couldn’t reach the graph."
          : counts &&
            `${counts.files.toLocaleString()} files · ${counts.testFiles.toLocaleString()} tests · ${counts.symbols.toLocaleString()} symbols`}
      </span>
    </header>
  );
}
