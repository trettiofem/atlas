# AGENTS.md

## Web UI: Atlas

The web UI in [web/](web/) is **Atlas**, a code analysis app built on the code graph. `pnpm web` serves it on the `PORT` set in [src/web.ts](src/web.ts).

### Stack and layout

- React 19, Tailwind CSS v4 and shadcn/ui (`new-york-v4` style, Radix primitives), with Lucide icons.
- [src/web.ts](src/web.ts) is the Vite config. It is inline with `configFile: false` and sets the Tailwind plugin and the `@` → `web/` alias. There is no `vite.config.ts`.
- shadcn components are in `web/components/ui/` and `cn` is in `web/lib/utils.ts`. These files are ours to edit. The shadcn CLI doesn't run in this layout (no `package.json` in `web/`). To add a component, fetch `https://ui.shadcn.com/r/styles/new-york-v4/<name>.json`, write its `files[].content`, rewrite `@/registry/new-york-v4/ui/` → `@/components/ui/` and `"cn"` → `"@/lib/utils"`, and add its npm `dependencies` at the repo root.
- Theme tokens are in [web/style.css](web/style.css).
- [web/main.tsx](web/main.tsx) holds the shell and the hash routes: `#/`, `#/search`, `#/agents[/<id>]`, `#/graph`.
- Pages: [web/home.tsx](web/home.tsx) and [web/agents.tsx](web/agents.tsx). Search and Code Graph are placeholders.
- Shared components: [web/app-sidebar.tsx](web/app-sidebar.tsx), [web/prompt-box.tsx](web/prompt-box.tsx) (the prompt box on both pages) and [web/agent-icon.tsx](web/agent-icon.tsx) (the status dot).
- **Mock data**: agents, transcripts and source are in [web/mock.tsx](web/mock.tsx). The sidebar's "Latest" list reads from it too. Sending a prompt does nothing yet.

### Design tokens

Use the Tailwind token classes (`text-neutral-33`, `bg-blue`) or the shadcn semantic classes (`text-muted-foreground`, `border-border`). Never write hex values in components. Tailwind's own `neutral-*` scale is cleared, so `neutral-*` always means these:

| Token | Hex | Role | shadcn alias |
|---|---|---|---|
| `neutral-0` | `#0C0A09` | Text | `foreground`, `primary` |
| `neutral-33` | `#44403B` | Icons, muted text | `muted-foreground`, `ring` |
| `neutral-67` | `#D6D3D1` | Borders, dividers | `border`, `input` |
| `neutral-100` | `#FAFAF9` | Background (app, sidebar, cards, inputs) | `background`, `sidebar` |
| `blue` | `#2176CC` | Logo, **ready** agents | none |
| `salmon` | `#FF7D6E` | **Working** agents | `destructive` (placeholder) |

- **Hover / active fill**: `accent` is neutral-67 mixed 40% into neutral-100. It is the only derived color.
- **Light mode only.** The palette has no dark values yet, so don't add `dark:` styling until it does.

### Typography

- **Headings**: Geist Bold with tight tracking (`font-bold tracking-tight`). The Home title is `text-2xl`.
- **Body**: Geist 14px (`text-sm`, the body default). UI labels use `font-medium`.
- **Mono**: Geist Mono (`font-mono`) for symbol names, file paths, code, line numbers and the footer tagline (`text-xs`).
- The fonts come from `@fontsource-variable/geist` and `geist-mono` and load locally, without Google Fonts.

### Shape and surfaces

- One flat background (neutral-100) everywhere. Sections are separated by 1px neutral-67 borders, never by background colors or drop shadows.
- **Raised controls**: interactive controls (buttons, text boxes, the prompt box) have a 2px neutral-67 border and a 4px bottom. That's `border-2` plus `shadow-raised`, a solid 2px lip below the border.
  - The `outline` button variant, `InputGroup`, `Input` and `Textarea` already include it. Inside `InputGroupButton`, add `className="shadow-raised"` because that component forces `shadow-none`.
  - **Pressed**: raised buttons sink when clicked (`active:translate-y-0.5 active:shadow-none`, already in the `outline` variant). The face drops 2px onto the lip, faking a 3D key.
  - The lip is a shadow, not `border-b-4`. shadcn buttons have fixed heights, so thinning a real bottom border on press would push the bottom edge down instead of sinking the face.
  - Ghost buttons (sidebar trigger, close `X`, file references) and non-interactive surfaces stay flat.
- **Radius**: `--radius` is 0.5rem. Buttons and chips are `rounded-md` (6px). The prompt box and large containers are `rounded-xl` (12px).
- **Focus**: the prompt box shows focus with a darker border (`border-ring`), not a halo. Other controls keep shadcn's ring.
- **Icons**: Lucide at 16px (`size-4`) in neutral-33. Icon-only buttons are 32px square (`size="icon-sm"`) and need an `aria-label`.

### Agent status dot

A 6px dot (`size-1.5 rounded-full`) sits on the top-right corner of the `Bot` icon (`absolute -top-0.5 -right-0.5`): `bg-blue` means ready for another prompt, and `bg-salmon` means working. Always pair it with screen-reader text (`sr-only`). Use `AgentIcon` from `agent-icon.tsx`.

### Sidebar

- 12.5rem (200px) wide and collapsible to a 3rem icon rail (shadcn `Sidebar collapsible="icon"`, ⌘B toggles it).
- On mobile it becomes a sheet, opened by a trigger at the top of the page.
- **Expanded**:
  - Header: `LogoWordmark.svg` on the left and the collapse trigger on the right.
  - Nav: Home (`House`), Search (`Search`), Agents (`Bot`), Code Graph (`Waypoints`, a stand-in for the mockup's icon).
  - "Latest": the symbols and agents the user last touched. Symbols show a `File` icon and mono text. Agents show `AgentIcon` and sans text. All entries truncate with an ellipsis.
- **Collapsed**: `Logo.svg` at the top, nav icons with tooltips, "Latest" hidden, and the trigger at the bottom.
- What the nav items do:
  - Home: start a chat. Sending a prompt creates an agent and opens the Agents page.
  - Search: find symbols.
  - Agents: create and manage agents that search the code base.
  - Code Graph: interactive graph exploration.

### Home page

A centered column 512px wide (`max-w-lg`), vertically centered, containing, from top to bottom:
- `LogoLarge.svg` followed by "What’s up?"
- The prompt box: an auto-growing textarea with the placeholder "Ask me anything about the code base…", a `+` (add context) button bottom-left and an `ArrowRight` send button bottom-right. Enter sends and Shift+Enter adds a new line.
- A row of outline suggestion chips ("Explain a module", "Find dead code", "Find callers") that fill the prompt.
- The tagline "Atlas -- Intelligent Code Analysis Platform" in mono `text-xs`.

### Agents page

`#/agents/<id>` opens that agent, and `#/agents` opens the first. The page has three columns, separated by 1px borders, each scrolling on its own:
1. **Agent list** (250px, hidden on mobile):
   - Each agent shows an `AgentIcon`, then its bold one-line title. The description sits underneath, indented to line up with the title, and is cut off after 6 lines.
   - A border separates agents. The open agent gets the `accent` fill.
   - A full-width raised "+ Create" button below the list goes to Home, where new agents start.
2. **Conversation**:
   - Header (44px, bottom border): `AgentIcon` and the title in `font-medium`.
   - User messages: right-aligned raised bubbles.
   - Agent steps: muted rows with an icon, the step and its duration, such as "Queried code graph · 52ms" (`Waypoints`) and "Thought · 2s" (`CircleCheck`). A running step has no duration and a spinning `LoaderCircle`.
   - Answer: body text with inline `<code>` (Geist Mono, no background) and bullet lists.
   - File references (`FileRef`: a path plus optional `lines`): a ghost button with a `File` icon, the mono path and a `ChevronRight`. Clicking one opens the source panel.
   - When the agent highlights lines, the reference reads `path:19-22` and a bordered snippet of exactly those lines sits under it.
   - The prompt box is pinned to the bottom, with a top border.
3. **Source panel** (`min(30rem, 40%)`, covers the conversation on mobile):
   - A 44px header with the `File` icon, the mono path and a close `X`.
   - Mono `text-xs` code with a muted, right-aligned line-number gutter. Long lines scroll sideways.
   - The reference's lines are highlighted and scrolled to the center each time it's opened.
   - **Agent highlight** (the same in the snippet and the panel, from `CodeLines` in `agents.tsx`): a `bg-blue/10` tint across the full line width plus a 2px `border-blue` left edge. Blue here means "the agent is pointing at this".

### Assets

These are in `web/assets/`, already in `blue`:
- `Logo.svg`: 26×18 mark, used for the collapsed sidebar and the favicon.
- `LogoLarge.svg`: 39×27, the Home heading.
- `LogoWordmark.svg`: 72×18, the mark plus "Atlas" for the expanded sidebar.

### Voice

Short, casual and direct: "What’s up?", "Ask me anything about the code base…". Use sentence case for labels ("Find dead code"), except product nouns in the nav (Code Graph).
