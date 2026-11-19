# AGENTS.md

## Web UI: Atlas

The web UI in [web/](web/) is **Atlas**, a code analysis app built on the code graph. `pnpm web` serves it on the `PORT` set in [src/web.ts](src/web.ts).

### Stack and layout

- React 19, Tailwind CSS v4 and shadcn/ui (`new-york-v4` style, Radix primitives), with Lucide icons.
- [src/web.ts](src/web.ts) is the Vite config. It is inline with `configFile: false` and sets the Tailwind plugin and the `@` → `web/` alias. There is no `vite.config.ts`.
- shadcn components are in `web/components/ui/` and `cn` is in `web/lib/utils.ts`. These files are ours to edit. The shadcn CLI doesn't run in this layout (no `package.json` in `web/`). To add a component, fetch `https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`, write its `files[].content`, rewrite `@/registry/new-york-v4/ui/` → `@/components/ui/` and `"cn"` → `"@/lib/utils"`, and add its npm `dependencies` at the repo root.
- Theme tokens are in [web/style.css](web/style.css).
- [web/main.tsx](web/main.tsx) holds the shell and the hash routes: `#/`, `#/search[?<params>]`, `#/agents[/<id>]`, `#/artifacts[/<topic>]`, `#/graph[?<params>]`. It also sets the document title from the route: the open symbol, agent or artifact, then the page, then "Atlas" (`_minColorDistance · Symbols · Atlas`). Home is just "Atlas".
- Pages: [web/home.tsx](web/home.tsx), [web/search.tsx](web/search.tsx), [web/agents.tsx](web/agents.tsx), [web/artifacts.tsx](web/artifacts.tsx) and [web/graph.tsx](web/graph.tsx) (Code Graph).
- Shared components:
  - [web/app-sidebar.tsx](web/app-sidebar.tsx).
 - [web/project-header.tsx](web/project-header.tsx): `ProjectHeader`, the 40px bar above every page (bottom border). On the left are ghost switchers in mono `text-xs`: `FolderGit2` with the repo and `GitBranch` with the branch, each followed by `ChevronsUpDown`. On the right, muted "92 files · 16 tests · 736 symbols" from `/api/overview` (`overviewCounts`, so the numbers match Search's hint), or "No graph loaded." The counts are hidden on phones. On mobile the sidebar trigger sits at its start. The repo and branch are mock data (`PROJECT` in `mock.tsx`), and the switchers don't open yet.
  - [web/prompt-box.tsx](web/prompt-box.tsx): the prompt box on Home and Agents.
  - [web/agent-icon.tsx](web/agent-icon.tsx): the status dot.
  - [web/source.tsx](web/source.tsx): `CodeLines`, `SourceText` (a whole file, scrolled to its highlight) and `SourcePanel`, shared by Agents and Search. Every code view goes through `CodeLines`, which takes the whole file's text and path. Snippets pass `only` with their lines, so they're colored in the context of the whole file.
 - [web/highlight.ts](web/highlight.ts): syntax highlighting with Shiki (`useTokens`). It picks the language from the path's extension, loads that grammar on demand and caches the last 20 files. Code shows plain until the tokens arrive, and stays plain for unknown languages.
  - [web/symbol.tsx](web/symbol.tsx): `SymbolIcon`, kind labels, `PathLabel`, `searchHref` and `graphHref`.
  - [web/chat.tsx](web/chat.tsx): `UserMessage` (the raised bubble), `Step` (an icon, a label and a duration, or a spinner while running) and `TurnView`, which renders one transcript turn (message, step, markdown answer, file reference with its snippet, or error). Shared by Agents and the Explain chat.
  - [web/agents-store.ts](web/agents-store.ts): every agent, kept live by one `EventSource` on `/api/agents/events` (`useAgents`), plus `createAgent` and `sendMessage`.
  - [web/explain.tsx](web/explain.tsx): the Explain tip and the Explain chat dialog (`components/ui/dialog.tsx`).
 - [web/tunnel.tsx](web/tunnel.tsx): `Tunnel`, the generated SVG wireframe tunnel behind Home.
 - [web/graph-canvas.tsx](web/graph-canvas.tsx): `GraphCanvas`, the Cytoscape view of the Code Graph, and [web/graph-model.ts](web/graph-model.ts), the pure model of what it shows (tested in `graph-model.test.ts`).
- **Backend**: everything is live. [web/api.ts](web/api.ts) has the row, graph, agent and turn types, `useApi(url)`, which fetches [src/api.ts](src/api.ts) and aborts stale requests, and `fetchJson` for one-off requests and POSTs. A 503 means no graph is loaded, or, for agent routes, that `CLAUDE_API_KEY` isn't set.
- **Agents and the Explain chat** run on the server with the Anthropic Messages API, Haiku by default (`CLAUDE_MODEL` overrides it), using the key in `.env` (`CLAUDE_API_KEY`). [src/agent.ts](src/agent.ts) is the run loop. It starts [src/mcp.ts](src/mcp.ts) as an MCP client over stdio, so Claude gets the same code-graph tools as Claude Code, plus a local `show_code` tool that adds a file reference with its lines to the transcript. [src/agents.ts](src/agents.ts) keeps agents in memory, streams changes, and recovers agents a stopped server left working.
- **Agents storage**: [src/agents-db.ts](src/agents-db.ts) saves agents in SQLite, in the `agents` table of `atlas.db` (git-ignored, opened by [src/store.ts](src/store.ts) and shared with artifacts), separate from the code graph. Turns and the Anthropic history are JSON columns. Agents have no owner yet; add users before agents have several.
- **Mock data**: the user (`USER` in [web/mock.tsx](web/mock.tsx)), shown in the sidebar footer and as every agent's creator, and the project header's repo and branch (`PROJECT`).
- **Recent**: [web/recent.ts](web/recent.ts) keeps, in localStorage and each with the time it was touched, the last 8 symbols opened in Search, artifacts opened (deleting one drops it) and agents opened or messaged. Opening means picking one, not the newest a page shows by default. The sidebar's "Recent" merges them.

### Design tokens

Use the Tailwind token classes (`text-neutral-33`, `bg-blue`) or the shadcn semantic classes (`text-muted-foreground`, `border-border`). Never write hex values in components. Tailwind's own `neutral-*` scale is cleared, so `neutral-*` always means these:

| Token | Hex | Role | shadcn alias |
|---|---|---|---|
| `neutral-0` | `#0C0A09` | Text | `foreground`, `primary` |
| `neutral-33` | `#44403B` | Icons, muted text | `muted-foreground` |
| `neutral-67` | `#D6D3D1` | Borders, dividers | `border`, `input` |
| `neutral-100` | `#FAFAF9` | Background (app, sidebar, cards, inputs) | `background`, `sidebar` |
| `blue` | `#2176CC` | Logo, **ready** agents, primary button fill, focus | `ring` |
| `dark-blue` | `#19599A` | Primary button border and lip | none |
| `salmon` | `#FF7D6E` | **Working** agents | `destructive` (placeholder) |
| `purple` | `#C878AF` | Syntax: keywords | none |
| `green` | `#26854C` | Syntax: strings | none |
| `yellow` | `#F3A833` | Syntax: numbers and literals | none |

- **Hover / active fill**: `accent` is neutral-67 mixed 40% into neutral-100. Apart from the syntax colors, it is the only derived color.
- **Syntax colors**: the `--syntax-*` variables in `style.css` feed Shiki's CSS-variables theme. Keywords are a darkened `purple`, functions and types `blue`, strings a darkened `green`, numbers and `true`/`false`/`null` a darkened `yellow`, comments a lightened neutral-33 and punctuation neutral-33. Shiki's broad "constant" group (which also covers objects and property names) stays plain text, so the literals get their own rule in `highlight.ts` (`--syntax-token-number`). Everything else is plain text. The mixed colors keep 4.5:1 contrast on the background.
- **Light mode only.** The palette has no dark values yet, so don't add `dark:` styling until it does.

### Typography

- **Headings**: Geist Bold with tight tracking (`font-bold tracking-tight`). The Home title is `text-2xl`.
- **Body**: Geist 14px (`text-sm`, the body default). UI labels use `font-medium`.
- **Mono**: Geist Mono (`font-mono`) for symbol names, file paths, code, and line numbers.
- The fonts come from `@fontsource-variable/geist` and `geist-mono` and load locally, without Google Fonts.

### Shape and surfaces

- One flat background (neutral-100) everywhere. Sections are separated by 1px neutral-67 borders, never by background colors or drop shadows.
- **Raised controls**: interactive controls (buttons, text boxes, the prompt box) have a 1px neutral-67 border and a 3px bottom. That's `border` plus `shadow-raised`, a solid 2px lip below the border.
  - The `outline` button variant, `InputGroup`, `Input`, `Textarea` and `DialogContent` already include it. Inside `InputGroupButton`, add `className="shadow-raised"` because that component forces `shadow-none`.
  - **Pressed**: raised buttons sink when clicked (`active:translate-y-0.5 active:shadow-none`, already in the `outline` variant). The face drops 2px onto the lip, faking a 3D key.
  - **Toggled**: an `outline` button with `aria-pressed` set to true stays sunk and gets the `accent` fill, like a latched key. Search's kind chips use it. It's in the variant already, so just set `aria-pressed`.
  - **Primary**: the `primary` button variant is raised the same way, with a `blue` fill, `neutral-100` text, and a `dark-blue` border and lip (`shadow-raised-primary`). It sinks when pressed like `outline`. Inside `InputGroupButton`, add `className="shadow-raised-primary"`. Use it for the one main action in a view. Don't confuse it with shadcn's `primary` token, which is `neutral-0` and drives the `default` variant.
  - The lip is a shadow, not `border-b-4`. shadcn buttons have fixed heights, so thinning a real bottom border on press would push the bottom edge down instead of sinking the face.
  - Ghost buttons (sidebar trigger, close `X`, file references) and non-interactive surfaces stay flat.
- **Radius**: `--radius` is 0.5rem. Buttons and chips are `rounded-md` (6px). The prompt box and large containers are `rounded-xl` (12px).
- **Focus**: `ring` is `blue`. The prompt box shows focus with a blue border (`border-ring`), not a halo. Other controls keep shadcn's ring: a blue border plus a translucent blue halo.
- **Icons**: Lucide at 16px (`size-4`) in neutral-33. Icon-only buttons are 32px square (`size="icon-sm"`) and need an `aria-label`.
- **Tabs** (`web/components/ui/tabs.tsx`): triggers are raised `outline` buttons (`size="sm"`), and the active one stays sunk with the `accent` fill, like a toggled chip. There's no track. A tab bar has `p-4` and a bottom border, like the search block on Search.

### Symbol kinds

`SymbolIcon` from `symbol.tsx` gives each graph kind a Lucide icon, always with `sr-only` kind text: `Box` for Type, `SquareFunction` for Method, `Variable` for Term, `Package` for Namespace, `Hash` for Macro, `File` for the Code Graph's file nodes, and `Code` otherwise. In the UI the kinds are named in plain words: Type, Function, Variable, Namespace, Macro, with plural chip labels ("Functions"). Paths use `PathLabel`, where the directory truncates first so `basename:line` stays visible.

### Agent status dot

A 6px dot (`size-1.5 rounded-full`) sits on the top-right corner of the `Bot` icon (`absolute -top-0.5 -right-0.5`): `bg-blue` means ready for another prompt, and `bg-salmon` means working. Always pair it with screen-reader text (`sr-only`). Use `AgentIcon` from `agent-icon.tsx`.

### Sidebar

- 12.5rem (200px) wide and collapsible to a 3rem icon rail (shadcn `Sidebar collapsible="icon"`, ⌘B toggles it).
- On mobile it becomes a sheet, opened by a trigger at the start of the project header.
- **Expanded**:
  - Header: `LogoWordmark.svg` on the left and the collapse trigger on the right.
  - Nav: Home (`House`), Agents (`Bot`), Artifacts (`ScrollText`), Symbols (`BookSearch`, the Search page at `#/search`), Code Graph (`Waypoints`, a stand-in for the mockup's icon).
  - "Recent": the 8 symbols, artifacts and agents the user last touched, in one list, the last touched first. An agent's time is when it was created, or later when the user opened or messaged it. Symbols show their `SymbolIcon` and mono text and link back to Search, artifacts `ScrollText` and the topic, agents `AgentIcon` and the title, both in sans text. All entries truncate with an ellipsis.
  - Footer: the user, with the 24px `UserLarge.svg` avatar, the name in `font-medium` and the muted org underneath. It's mock data (`USER` in `mock.tsx`) and does nothing yet.
- **Collapsed**: `Logo.svg` at the top, nav icons with tooltips, "Recent" hidden, and at the bottom the avatar above the trigger.
- What the nav items do:
  - Home: start a chat. Sending a prompt creates an agent and opens the Agents page.
  - Agents: create and manage agents that search the code base.
  - Artifacts: read and delete the write-ups agents saved.
  - Symbols: find symbols.
  - Code Graph: interactive graph exploration.

### Home page

A centered column 512px wide (`max-w-lg`), vertically centered, containing, from top to bottom:
- `LogoLarge.svg` followed by "What’s up?"
- The prompt box: an auto-growing textarea with the placeholder "Ask me anything about the code base…", a `+` (add context) button bottom-left and a `primary` `ArrowUp` send button bottom-right. Enter sends and Shift+Enter adds a new line.
- A row of outline suggestion chips ("Explain a module", "Find dead code", "Find callers"). Each fills the prompt with a fuller request that says what to cover and how to list results. A `[bracketed]` blank such as `[function name]` is selected when the chip fills the prompt, so typing replaces it. Prompts without a blank put the cursor at the end.
- The tagline, "Atlas -- Intelligent Code Analysis Platform", in mono `text-xs`, 4rem below the chips.
On load the column's parts enter one after another, top to bottom, 80ms apart: the logo, the title, the prompt box, the chips and the tagline. (The project header above the page says which code base you're asking about.) Each one fades in, rises 0.5rem and comes into focus from a 4px blur, using `animate-intro` (500ms) from `style.css`. The tunnel fades in over 1s. It's all `motion-safe:`, so reduced motion shows the page at once. The prompt box animates inside its measured wrapper, because the tunnel reads that wrapper's position and a transform on it would throw off the vanishing point.

Behind the column is a 3D wireframe tunnel (`Tunnel`): 1px neutral-67 lines on the flat background, in one-point perspective, with the vanishing point at the prompt box's center. It's an SVG generated from the page size, re-measured on resize. Its empty end wall (640×480 by default) frames the column, so no lines cross the text. Props set the end size, the line counts (`columns`, `rows`) and the camera `depth`. Floor cells are square in 3D, so the cross-lines bunch up toward the end.

### Search page

Everything is in the hash: `#/search?q=<text>&kind=<label>&name=&file=&line=<symbol>&tab=<tab>`. Names aren't unique, so a symbol is `name`, `file` and `line` together. Typing (debounced 150ms), kind chips and tabs replace the history entry. Opening a symbol pushes one, so Back walks back through the symbols you visited. The layout matches Agents: three columns separated by 1px borders, each scrolling on its own.
1. **Results** (320px, full width on mobile until a symbol is open):
   - A top block (`border-b p-4`) with a raised `InputGroup`: a `Search` icon, "Find a symbol…", and a spinning `LoaderCircle` while results load. Enter opens the first result.
   - Below it, kind chips ("All", "Types", "Functions"…): toggled `outline` buttons, only for kinds the loaded graph has.
   - Rows like the agent list: a `SymbolIcon` and mono name, and underneath, indented to line up with the name, a muted `PathLabel` with the line. A border separates rows, and the open symbol gets the `accent` fill.
   - Hints are muted body text: "Search N symbols across M files.", "No symbols match “x”.", and "Showing the first 50…" at the API's limit.
2. **Symbol view**:
   - Header (44px): `SymbolIcon`, the mono name in `font-medium`, the muted kind (hidden on phones, to leave room for the name) and the `PathLabel` on the right. On mobile, an `ArrowLeft` goes back to the results.
   - A tab bar with counts: Source, Callers, Callees, References, Tests, Impact.
   - **Source**: the whole file, with the definition highlighted and scrolled to the center. Hovering the highlight shows the Explain tip (see "Explain chat" below).
   - **Callers / Callees**: symbol rows that open that symbol on its Source tab. Back returns to the list you came from.
   - **References / Tests / Impact**: file rows (`File` icon, path, a muted note on the right such as "2 refs" or "test", and "in …" or "via …" underneath). They open the peek panel.
   - Empty tabs say so in a muted line. An empty Callers tab adds that top-level code isn't counted.
   - With nothing selected, it shows a centered muted hint and the project root.
3. **Peek panel**: the Agents source panel (`SourcePanel`), loading the file from `/api/file`. The graph has no lines for references, so nothing is highlighted there.
- The definition in the Source tab uses the same blue highlight as Agents (see "Code highlight" under the Agents page).
- If no graph is loaded (503), the page shows "The graph isn’t loaded." with the `pnpm graph sync` command (`GraphUnavailable`, which Code Graph shares).
- The symbol header ends with a ghost `Waypoints` link, "Show in Code Graph", that opens the symbol on the Code Graph page.

### Code Graph page

Interactive exploration of the graph, drawn with [Cytoscape.js](https://js.cytoscape.org) and the fCoSE layout. `#/graph?name=&file=&line=` (or `?id=<node id>`) opens on that symbol; otherwise the page keeps whatever graph you left, for the session. Three columns, like Search:
1. **Tools** (320px; on mobile a block above the canvas, at most 45% of the height). A tab bar with "Explore" and "Path".
 - **Explore**: a raised `InputGroup`, "Find a symbol or file…" (Enter takes the first result, Escape clears it), over rows like Search's: `SymbolIcon`, the mono name (a file's basename), and the `PathLabel` underneath. Results already on the graph say "shown". Picking one adds it with its neighbors and selects it. With no query it shows "Search N symbols across M files." and "On the graph · N", the shown nodes, which select and center the node.
 - **Path**: "From" and "To" fields, each a search like Explore's, or "Use <selected node>". A chosen end shows as a raised field with its icon, name and a clear `X`. A ghost `ArrowDownUp` swaps them. "Direction" chips ("Any", "Follow arrows") and "Through" chips ("Uses", "Nesting", "Files", the legend's three line kinds), then a full-width `primary` "Find path" (`Route`). A found path lists its stops as node rows, with the edge between each pair ("↓ uses", "↑ referenced in") and a ghost `X` ("Clear path"). With none: "No path within 12 steps." A muted note says paths skip external symbols.
2. **Canvas**: the graph, with a row of raised icon buttons top right (zoom in and out, "Fit to view", "Rearrange", "Clear graph", each with a tooltip), a spinner top left while requests run, and the legend bottom left. Empty, it says "Start from a symbol or file." with how expanding works.
3. **Inspector** (320px, over everything on mobile), for the selected node. A 44px header with its icon, mono name, a ghost `Trash2` (remove from the graph) and close `X`. Then the kind ("Function", "External function", "Test file") and `PathLabel` or package; `outline` buttons "Expand" / "Collapse", "Symbols" (opens it in Search), "Path from here" and "Path to here". Then one toggle row per edge group ("Uses 89", "Used by", "Defined in", "Imports"…) with `CirclePlus` / `CircleMinus`: the row gets the `accent` fill while its group is shown, reads "10 of 89" when only some are, and "More" loads up to 200. Last, a symbol's definition as a bordered `CodeLines` snippet.

How the graph behaves:
- **Nodes** are drawn as the app's raised chips (border, 2px lip, `rounded-md`): the kind icon, the mono name (cut at 28 characters) and a badge, `CirclePlus` when it has hidden neighbors or `CircleMinus` once expanded. Clicking the badge or double-clicking the node expands or collapses it; clicking elsewhere selects it. The selected chip sinks with the `accent` fill and a blue border, like a toggled key. External symbols have a dashed border and muted text. Nodes can be dragged. Chips are SVG images built at runtime from the theme's CSS variables, so the palette still lives only in `style.css`.
- **Expanding** shows up to 10 neighbors per edge group (project code first, busiest edges first), and the edges between every shown node. **Collapsing** hides what that expansion brought in, recursively, unless something else keeps it: the user added it, another expanded node shows it, or it's on the path. Parameters are never shown.
- **Edges**: arrows from source to target in muted neutral-33. Solid lines are uses (`USES`, `IMPLEMENTS`, `TYPE_OF`), dashed are nesting (`CONTAINS`, `DEFINES`) and dotted are files (`REFERENCES`, `IMPORTS`). Hovering an edge shows its label ("uses"); edges at the selected node are darker.
- **Paths**: the server's bidirectional breadth-first search finds one of the shortest paths, up to 12 steps, through the chosen edge kinds and never through external symbols. Its nodes and edges turn blue (the code highlight's tint and edge on chips, labeled 2px edges), everything else fades, and the view frames the path.
- **Layout**: new nodes start beside a shown neighbor, then fCoSE settles everything while the expanded node stays put, overlapping chips are pushed apart, and nodes animate to their places. The view follows new nodes when they land outside it, never zooming past 125%. "Rearrange" lays everything out from scratch. With reduced motion nothing animates.

### Explain chat

A one-time chat about highlighted code. It isn't an agent: it doesn't show on the Agents page or in "Recent", and closing it ends the chat. Each open starts fresh.
 - **Tip**: `ExplainTip` is passed as `highlightAction` to `CodeLines`, `SourceText` or `SourcePanel`, which put the highlighted lines in one `group/highlight` block.
  - It looks like the app's tooltips (`bg-foreground`, `text-background`, `text-xs`, `rounded-md`, with an arrow) plus a `Sparkles` icon and "Explain". It sits flush on top of the highlight, at the start of the code column.
  - It shows while the highlight or the tip is hovered, and on keyboard focus, so it's a real button that Tab reaches.
  - When the highlight starts at the file's first line, it goes underneath instead.
- **Dialog** (`components/ui/dialog.tsx`): raised like the prompt box (`border` plus `shadow-raised`) and `rounded-xl`, over a translucent white overlay (`bg-background/70`) that Sheet uses too. It's 672px wide (`sm:max-w-2xl`) and `min(40rem, 85svh)` tall.
  - Header (44px): `Sparkles`, then "Explain" and the mono symbol name in `font-medium`. The dialog's ghost close `X` sits in it.
  - Transcript: the muted `path:from-to` with a `File` icon, and a bordered snippet of the lines (the blue highlight, at most 240px tall). Then the user's messages (`UserMessage`, starting with "Explain this code"), each followed by its reply, rendered with `TurnView` like an agent's. A running `Step`, "Thinking…", shows until the reply starts.
  - The prompt box is pinned to the bottom with a top border and gets focus. Follow-ups are added to the transcript, and sending waits until the reply is done.
  - Each reply is a POST to `/api/explain` with the whole chat (the client keeps it), streamed back as NDJSON snapshots of the reply's turns. Closing the dialog aborts it.

### Agents page

`#/agents/<id>` opens that agent, and `#/agents` opens the newest. `#/agents/new` is an empty conversation: a "New agent" header (`Bot`), a centered muted hint and the focused prompt box. Sending creates the agent and replaces the URL with its own, so Back skips the empty one. With no agents the page says "No agents yet. Start one." and links to `#/agents/new`. The page has three columns, separated by 1px borders, each scrolling on its own:
1. **Agent list** (320px, hidden on mobile):
 - A top block (`border-b p-4`): a raised `InputGroup` like Search's (a `Search` icon and "Find an agent…") and, beside it, a square `primary` icon button (`Plus`, `aria-label` "Create") that opens a new conversation (`#/agents/new`). The field filters the list as you type (Escape clears it) with `fuzzyFilter` from [web/fuzzy.ts](web/fuzzy.ts). Every query word has to match a word in the title, description or creator's name, by prefix, inside the word, with letters missing or with a typo, and title matches rank first. With no match it says "No agents match “x”."
 - Each agent shows an `AgentIcon`, then its bold one-line title. The description sits underneath, indented to line up with the title, and is cut off after 6 lines.
 - Claude names a new agent from its prompt, which takes a second or two. Until then (`named` is false), the title and description are skeleton lines (`bg-border`, since `bg-accent` vanishes on the open row). The conversation header and "Recent" show skeletons the same way. If naming fails or the server restarts, the prompt stays as the name.
 - Under the `AgentIcon`, level with the description's first line, the 12px `User.svg` avatar shows who created the agent (`creator`, with "Created by …" as its alt text and tooltip). For now it's always the mock `USER`.
   - A border separates agents. The open agent gets the `accent` fill.
2. **Conversation**:
   - Header (44px, bottom border): `AgentIcon` and the title in `font-medium`, and on the right a ghost `Trash2` button ("Delete agent"). It asks first in a small dialog ("Delete this agent?", with `outline` "Cancel" and `primary` "Delete"). Deleting stops a working agent, removes it from every open tab and opens the newest agent.
   - User messages: right-aligned raised bubbles (`UserMessage` in `chat.tsx`).
   - Agent steps: muted rows with an icon, the step and its duration. Each code-graph tool call is one (`Waypoints`), such as "Found callers of buildGraph · 8ms". Waiting on Claude for more than a second shows "Thought · 2s" (`CircleCheck`). A running step has no duration and a spinning `LoaderCircle`.
   - Consecutive steps fold into one muted row (`Transcript` in `chat.tsx`), so tool calls don't fill the screen: "Queried the code graph 15 times · 21s" (or "Thought · 4s" if there were no queries), with a `ChevronRight` that turns down when expanded and lists the steps, indented behind a left border. While a step runs, the row shows that step with the spinner. A lone step shows as it is. The Explain chat folds steps the same way.
   - Answer: markdown (`react-markdown`) as body text, with inline `<code>` (Geist Mono, no background) and bullet lists. Answers stream in as they're written.
   - Errors (API failures, an interrupted run): a muted row with `CircleAlert`.
   - File references (`FileRef`: a path plus optional `lines`), added when the agent calls `show_code`: a ghost button with a `File` icon, the mono path (`text-xs`, so it matches the body text visually) and a `ChevronRight`. Clicking one opens the source panel.
   - When the agent highlights lines, the reference reads `path:19-22` and a bordered snippet of exactly those lines sits under it.
   - The transcript follows new turns unless you've scrolled up.
   - The prompt box is pinned to the bottom, with a top border. Sending is disabled while the agent works (the status dot is salmon), but you can draft.
3. **Source panel** (`min(30rem, 40%)`, covers the conversation on mobile):
   - A 44px header with the `File` icon, the mono path and a close `X`.
   - Mono `text-xs` code with a muted, right-aligned line-number gutter. Long lines scroll sideways.
   - The reference's lines are highlighted and scrolled to the center each time it's opened. Hovering the highlight shows the Explain tip, like Search's Source tab. With no symbol name, the Explain dialog's header uses the file's basename.
   - **Code highlight** (from `CodeLines` in `source.tsx`, the same in the snippet, the panel and Search's Source tab): a `bg-blue/10` tint across the full line width plus a 2px `border-blue` left edge. Blue means "look here": the lines the agent points at, or the definition of the symbol you picked.

### Artifacts page

The write-ups agents save with `save_artifact` (see the README), for reading and deleting. Agents write them, so there's no Create. `#/artifacts/<topic>` opens one (the topic is URI-encoded, since topics are unique per project), and `#/artifacts` opens the newest on desktop and just the list on mobile. Data comes from `GET /api/artifacts` (every artifact with its `staleFiles`). Without a graph it shows `GraphUnavailable`, since artifacts belong to the loaded project's root. With none it says "No artifacts yet. Agents save one after a long investigation." Three columns like Agents:
1. **List** (320px; on mobile the whole page until an artifact is open):
   - A top block (`border-b p-4`) with a raised `InputGroup`, "Find an artifact…", filtering with `fuzzyFilter` on the topic, summary, files and symbols (Escape clears it). With no match: "No artifacts match “x”."
   - Rows: `ScrollText`, the bold one-line topic, the summary underneath (cut after 3 lines), and a muted line with the day it was last updated, plus "· 2 files changed" when covered files changed since it was saved. A border separates rows, and the open one gets the `accent` fill.
2. **Artifact view**:
   - Header (44px): on mobile an `ArrowLeft` back to the list, `ScrollText`, the topic in `font-medium`, and a ghost `Trash2` ("Delete artifact"). It asks first, like deleting an agent ("Delete this artifact?"), then sends `DELETE /api/artifacts?topic=`, drops it from the list and opens the newest.
   - The muted summary and "Updated <date>", then the markdown. Unlike answers it keeps its headings (`font-bold tracking-tight`, a markdown `#` is an `h2` under the topic). Lists, links and code blocks are the chat's (`MARKDOWN` in `chat.tsx`).
   - "Files": a bordered box of Search's `FileRow`s, with "changed since" on the right for stale files. They open the source panel.
   - "Symbols": `outline` mono chips that open Search with the name in the field and the symbol selected. Artifacts store only names, so a click looks the name up (`find`), preferring a definition in the artifact's files. With no match it only searches for the name.
3. **Source panel**: `SourcePanel`, nothing highlighted, like Search's peek panel.

### Assets

These are in `web/assets/`, already in `blue`:
- `Logo.svg`: 26×18 mark, used for the collapsed sidebar and the favicon.
- `LogoLarge.svg`: 39×27, the Home heading.
- `LogoWordmark.svg`: 72×18, the mark plus "Atlas" for the expanded sidebar.

### Voice

Short, casual and direct: "What’s up?", "Ask me anything about the code base…". Use sentence case for labels ("Find dead code"), except product nouns in the nav (Code Graph).
