# AGENTS.md

## Web UI: Atlas

The web UI in [web/](web/) is **Atlas**, a code analysis app built on the code graph. `pnpm web` serves it on the `PORT` set in [src/web.ts](src/web.ts).

### Stack and layout

- React 19, Tailwind CSS v4 and shadcn/ui (`new-york-v4` style, Radix primitives), with Lucide icons.
- [src/web.ts](src/web.ts) is the Vite config. It is inline with `configFile: false` and sets the Tailwind plugin and the `@` → `web/` alias. There is no `vite.config.ts`.
- shadcn components are in `web/components/ui/` and `cn` is in `web/lib/utils.ts`. These files are ours to edit. The shadcn CLI doesn't run in this layout (no `package.json` in `web/`). To add a component, fetch `https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`, write its `files[].content`, rewrite `@/registry/new-york-v4/ui/` → `@/components/ui/` and `"cn"` → `"@/lib/utils"`, and add its npm `dependencies` at the repo root.
- Theme tokens are in [web/style.css](web/style.css).
- [web/main.tsx](web/main.tsx) holds the shell and the hash routes: `#/`, `#/search[?<params>]`, `#/agents[/<id>]`, `#/graph`. It also sets the document title from the route: the open symbol or agent, then the page, then "Atlas" (`_minColorDistance · Search · Atlas`). Home is just "Atlas".
- Pages: [web/home.tsx](web/home.tsx), [web/search.tsx](web/search.tsx) and [web/agents.tsx](web/agents.tsx). Code Graph is a placeholder.
- Shared components:
  - [web/app-sidebar.tsx](web/app-sidebar.tsx).
  - [web/prompt-box.tsx](web/prompt-box.tsx): the prompt box on Home and Agents.
  - [web/agent-icon.tsx](web/agent-icon.tsx): the status dot.
  - [web/source.tsx](web/source.tsx): `CodeLines`, `SourceText` (a whole file, scrolled to its highlight) and `SourcePanel`, shared by Agents and Search.
  - [web/symbol.tsx](web/symbol.tsx): `SymbolIcon`, kind labels, `PathLabel` and `searchHref`.
  - [web/chat.tsx](web/chat.tsx): `UserMessage` (the raised bubble) and `Step` (an icon, a label and a duration, or a spinner while running), shared by Agents and the Explain chat.
  - [web/explain.tsx](web/explain.tsx): the Explain tip and the Explain chat dialog (`components/ui/dialog.tsx`).
 - [web/tunnel.tsx](web/tunnel.tsx): `Tunnel`, the generated SVG wireframe tunnel behind Home.
- **Backend**: Search and Home's project row are live. [web/api.ts](web/api.ts) has the row types and `useApi(url)`, which fetches [src/api.ts](src/api.ts) and aborts stale requests. A 503 means no graph is loaded.
- **Mock data**: agents, transcripts and their source are in [web/mock.tsx](web/mock.tsx), and so are the agents in the sidebar's "Latest" list. Sending a prompt does nothing yet, and the Explain chat never answers.
- **Recent symbols**: [web/recent.ts](web/recent.ts) keeps the last 5 symbols opened in Search in localStorage, for "Latest".

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

- **Hover / active fill**: `accent` is neutral-67 mixed 40% into neutral-100. It is the only derived color.
- **Light mode only.** The palette has no dark values yet, so don't add `dark:` styling until it does.

### Typography

- **Headings**: Geist Bold with tight tracking (`font-bold tracking-tight`). The Home title is `text-2xl`.
- **Body**: Geist 14px (`text-sm`, the body default). UI labels use `font-medium`.
- **Mono**: Geist Mono (`font-mono`) for symbol names, file paths, code, and line numbers.
- The fonts come from `@fontsource-variable/geist` and `geist-mono` and load locally, without Google Fonts.

### Shape and surfaces

- One flat background (neutral-100) everywhere. Sections are separated by 1px neutral-67 borders, never by background colors or drop shadows.
- **Raised controls**: interactive controls (buttons, text boxes, the prompt box) have a 2px neutral-67 border and a 4px bottom. That's `border-2` plus `shadow-raised`, a solid 2px lip below the border.
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

`SymbolIcon` from `symbol.tsx` gives each graph kind a Lucide icon, always with `sr-only` kind text: `Box` for Type, `SquareFunction` for Method, `Variable` for Term, `Package` for Namespace, `Hash` for Macro, and `Code` otherwise. In the UI the kinds are named in plain words: Type, Function, Variable, Namespace, Macro, with plural chip labels ("Functions"). Paths use `PathLabel`, where the directory truncates first so `basename:line` stays visible.

### Agent status dot

A 6px dot (`size-1.5 rounded-full`) sits on the top-right corner of the `Bot` icon (`absolute -top-0.5 -right-0.5`): `bg-blue` means ready for another prompt, and `bg-salmon` means working. Always pair it with screen-reader text (`sr-only`). Use `AgentIcon` from `agent-icon.tsx`.

### Sidebar

- 12.5rem (200px) wide and collapsible to a 3rem icon rail (shadcn `Sidebar collapsible="icon"`, ⌘B toggles it).
- On mobile it becomes a sheet, opened by a trigger at the top of the page.
- **Expanded**:
  - Header: `LogoWordmark.svg` on the left and the collapse trigger on the right.
  - Nav: Home (`House`), Search (`Search`), Agents (`Bot`), Code Graph (`Waypoints`, a stand-in for the mockup's icon).
  - "Latest": the symbols and agents the user last touched. Symbols (the last 5 opened in Search) come first, with their `SymbolIcon` and mono text, and link back to Search. Agents show `AgentIcon` and sans text. All entries truncate with an ellipsis.
  - Footer: the user, with the 24px `UserLarge.svg` avatar, the name in `font-medium` and the muted org underneath. It's mock data (`USER` in `mock.tsx`) and does nothing yet.
- **Collapsed**: `Logo.svg` at the top, nav icons with tooltips, "Latest" hidden, and at the bottom the avatar above the trigger.
- What the nav items do:
  - Home: start a chat. Sending a prompt creates an agent and opens the Agents page.
  - Search: find symbols.
  - Agents: create and manage agents that search the code base.
  - Code Graph: interactive graph exploration.

### Home page

A centered column 512px wide (`max-w-lg`), vertically centered, containing, from top to bottom:
- `LogoLarge.svg` followed by "What’s up?"
- The project row, so users know which code base they're asking about: `FolderCode`, the root's folder name in mono `font-medium` (the full path in its tooltip), and on the right muted "92 files · 16 tests · 736 symbols" from `/api/overview`. `overviewCounts` in `api.ts` does the counting, so these numbers match Search's hint. The row has a fixed height so the prompt doesn't move when the overview loads. With no graph it reads "No project loaded."
- The prompt box: an auto-growing textarea with the placeholder "Ask me anything about the code base…", a `+` (add context) button bottom-left and a `primary` `ArrowRight` send button bottom-right. Enter sends and Shift+Enter adds a new line.
- A row of outline suggestion chips ("Explain a module", "Find dead code", "Find callers"). Each fills the prompt with a fuller request that says what to cover and how to list results. A `[bracketed]` blank such as `[function name]` is selected when the chip fills the prompt, so typing replaces it. Prompts without a blank put the cursor at the end.
On load the column's parts enter one after another, top to bottom, 80ms apart: the logo, the title, the project row, the prompt box and the chips. Each one fades in, rises 0.5rem and comes into focus from a 4px blur, using `animate-intro` (500ms) from `style.css`. The tunnel fades in over 1s. It's all `motion-safe:`, so reduced motion shows the page at once. The prompt box animates inside its measured wrapper, because the tunnel reads that wrapper's position and a transform on it would throw off the vanishing point.

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
- If no graph is loaded (503), the page shows "The graph isn’t loaded." with the `pnpm graph sync` command.

### Explain chat

A one-time chat about highlighted code. It isn't an agent: it doesn't show on the Agents page or in "Latest", and closing it ends the chat. Each open starts fresh.
- **Tip**: `ExplainTip` is passed as `highlightAction` to `CodeLines` or `SourceText`, which put the highlighted lines in one `group/highlight` block.
  - It looks like the app's tooltips (`bg-foreground`, `text-background`, `text-xs`, `rounded-md`, with an arrow) plus a `Sparkles` icon and "Explain". It sits flush on top of the highlight, at the start of the code column.
  - It shows while the highlight or the tip is hovered, and on keyboard focus, so it's a real button that Tab reaches.
  - When the highlight starts at the file's first line, it goes underneath instead.
- **Dialog** (`components/ui/dialog.tsx`): raised like the prompt box (`border-2` plus `shadow-raised`) and `rounded-xl`, over a translucent white overlay (`bg-background/70`) that Sheet uses too. It's 672px wide (`sm:max-w-2xl`) and `min(40rem, 85svh)` tall.
  - Header (44px): `Sparkles`, then "Explain" and the mono symbol name in `font-medium`. The dialog's ghost close `X` sits in it.
  - Transcript: the muted `path:from-to` with a `File` icon, and a bordered snippet of the lines (the blue highlight, at most 240px tall). Then the user's messages (`UserMessage`, starting with "Explain this code") and a running `Step`, "Thinking…".
  - The prompt box is pinned to the bottom with a top border and gets focus. Follow-ups are added to the transcript.

### Agents page

`#/agents/<id>` opens that agent, and `#/agents` opens the first. The page has three columns, separated by 1px borders, each scrolling on its own:
1. **Agent list** (250px, hidden on mobile):
   - Each agent shows an `AgentIcon`, then its bold one-line title. The description sits underneath, indented to line up with the title, and is cut off after 6 lines.
   - A border separates agents. The open agent gets the `accent` fill.
   - A full-width `primary` "+ Create" button below the list goes to Home, where new agents start.
2. **Conversation**:
   - Header (44px, bottom border): `AgentIcon` and the title in `font-medium`.
   - User messages: right-aligned raised bubbles (`UserMessage` in `chat.tsx`).
   - Agent steps: muted rows with an icon, the step and its duration, such as "Queried code graph · 52ms" (`Waypoints`) and "Thought · 2s" (`CircleCheck`). A running step has no duration and a spinning `LoaderCircle`.
   - Answer: body text with inline `<code>` (Geist Mono, no background) and bullet lists.
   - File references (`FileRef`: a path plus optional `lines`): a ghost button with a `File` icon, the mono path and a `ChevronRight`. Clicking one opens the source panel.
   - When the agent highlights lines, the reference reads `path:19-22` and a bordered snippet of exactly those lines sits under it.
   - The prompt box is pinned to the bottom, with a top border.
3. **Source panel** (`min(30rem, 40%)`, covers the conversation on mobile):
   - A 44px header with the `File` icon, the mono path and a close `X`.
   - Mono `text-xs` code with a muted, right-aligned line-number gutter. Long lines scroll sideways.
   - The reference's lines are highlighted and scrolled to the center each time it's opened.
   - **Code highlight** (from `CodeLines` in `source.tsx`, the same in the snippet, the panel and Search's Source tab): a `bg-blue/10` tint across the full line width plus a 2px `border-blue` left edge. Blue means "look here": the lines the agent points at, or the definition of the symbol you picked.

### Assets

These are in `web/assets/`, already in `blue`:
- `Logo.svg`: 26×18 mark, used for the collapsed sidebar and the favicon.
- `LogoLarge.svg`: 39×27, the Home heading.
- `LogoWordmark.svg`: 72×18, the mark plus "Atlas" for the expanded sidebar.

### Voice

Short, casual and direct: "What’s up?", "Ask me anything about the code base…". Use sentence case for labels ("Find dead code"), except product nouns in the nav (Code Graph).
