import cytoscape, { type Core, type EventObject, type LayoutOptions, type NodeSingular, type Position } from "cytoscape";
import fcose from "cytoscape-fcose";
import { CircleMinus, CirclePlus, type LucideIcon } from "lucide-react";
import { createElement, type Ref, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { EdgeType, GraphNode } from "@/api";
import { type GraphModel, hiddenEdges } from "@/graph-model";
import { cn } from "@/lib/utils";
import { kindIcon } from "@/symbol";

cytoscape.use(fcose);

const MONO = '"Geist Mono Variable", ui-monospace, monospace';
const SANS = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';

// A node is a raised chip like the app's buttons: a 28px face over a 2px lip, the kind icon, the name, and a badge
// that expands or collapses it.
const HEIGHT = 30;
const FACE = 28;
const PAD = 8;
const ICON = 16;
const GAP = 6;
const BADGE = 14;
const MAX_LABEL = 28;
const MAX_FIT_ZOOM = 1.25;

export const EDGE_WORD: Record<EdgeType, string> = {
  USES: "uses",
  CONTAINS: "contains",
  DEFINES: "defines",
  REFERENCES: "references",
  IMPORTS: "imports",
  IMPLEMENTS: "implements",
  TYPE_OF: "has type",
};

/** The theme's colors as rgb(), for the canvas and the chip images, which can't read CSS variables. */
interface Palette {
  text: string;
  muted: string;
  border: string;
  background: string;
  blue: string;
  accent: string;
  /** The code highlight's bg-blue/10. */
  tint: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixel = () => {
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  const paint = (color: string, alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    ctx.globalAlpha = 1;
  };
  const token = (name: string) => (paint(css.getPropertyValue(name).trim()), pixel());
  const over = (top: string, alpha: number, bottom: string) => (paint(bottom), paint(top, alpha), pixel());
  const background = token("--background");
  const border = token("--border");
  const blue = token("--ring");
  // `--accent` is a color-mix(); where the canvas can't parse that, mix it the same way by hand.
  ctx.fillStyle = background;
  const unset = ctx.fillStyle;
  const accentValue = css.getPropertyValue("--accent").trim();
  ctx.fillStyle = accentValue;
  const accent = ctx.fillStyle !== unset ? (paint(accentValue), pixel()) : over(border, 0.4, background);
  return { text: token("--foreground"), muted: token("--muted-foreground"), border, background, blue, accent, tint: over(blue, 0.1, background) };
}

type Look = "rest" | "hover" | "chosen" | "path" | "pathChosen";
type Badge = "expand" | "collapse" | null;

const iconMarkup = (Icon: LucideIcon, size: number, color: string) => renderToStaticMarkup(createElement(Icon, { size, color, "aria-hidden": true }));

const chips = new Map<string, string>();
/** A chip image, cached: most nodes share a few widths and kinds. */
function chip(p: Palette, width: number, kind: string | null, badge: Badge, look: Look, dashed: boolean) {
  const key = [width, kind, badge, look, dashed].join("|");
  const cached = chips.get(key);
  if (cached) return cached;
  // Chosen chips stay sunk like a toggled button; path chips get the code highlight's blue edge and tint.
  const sunk = look === "chosen" || look === "pathChosen";
  const onPath = look === "path" || look === "pathChosen";
  const y = sunk ? 2 : 0;
  const face = onPath ? p.tint : look === "rest" ? p.background : p.accent;
  const stroke = onPath || sunk ? p.blue : p.border;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">
    ${sunk ? "" : `<rect x="0" y="2" width="${width}" height="${FACE}" rx="6" fill="${onPath ? p.blue : p.border}"/>`}
    <rect x="0.5" y="${y + 0.5}" width="${width - 1}" height="${FACE - 1}" rx="5.5" fill="${face}" stroke="${stroke}"${dashed ? ' stroke-dasharray="3 2"' : ""}/>
    <g transform="translate(${PAD} ${y + (FACE - ICON) / 2})">${iconMarkup(kindIcon(kind), ICON, p.muted)}</g>
    ${badge ? `<g transform="translate(${width - PAD - BADGE} ${y + (FACE - BADGE) / 2})">${iconMarkup(badge === "expand" ? CirclePlus : CircleMinus, BADGE, p.muted)}</g>` : ""}
  </svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  chips.set(key, url);
  return url;
}

let measurer: CanvasRenderingContext2D | undefined;
function textWidth(text: string) {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  measurer.font = `12px ${MONO}`;
  return Math.ceil(measurer.measureText(text).width);
}

/** Files show their basename; the inspector has the whole path. */
export const nodeLabel = (node: GraphNode) => (node.kind === "File" ? node.name.slice(node.name.lastIndexOf("/") + 1) : node.name);

function nodeData(p: Palette, node: GraphNode, badge: Badge) {
  const full = nodeLabel(node);
  const label = full.length > MAX_LABEL ? `${full.slice(0, MAX_LABEL - 1)}…` : full;
  const text = textWidth(label);
  const width = PAD + ICON + GAP + text + (badge ? GAP + BADGE + PAD : PAD + 2);
  const dashed = node.external;
  const look = (l: Look) => chip(p, width, node.kind, badge, l, dashed);
  return {
    id: node.id,
    label,
    badge,
    w: width,
    // Cytoscape centers the label on the node; shift it past the icon.
    tx: PAD + ICON + GAP + text / 2 - width / 2,
    img: look("rest"),
    imgHover: look("hover"),
    imgChosen: look("chosen"),
    imgPath: look("path"),
    imgPathChosen: look("pathChosen"),
  };
}

const stylesheet = (p: Palette): cytoscape.StylesheetJson => [
  {
    selector: "node",
    style: {
      shape: "rectangle",
      width: "data(w)",
      height: HEIGHT,
      "background-opacity": 0,
      "border-width": 0,
      "background-image": "data(img)",
      "background-width": "100%",
      "background-height": "100%",
      "background-clip": "none",
      label: "data(label)",
      "font-family": MONO,
      "font-size": 12,
      color: p.text,
      "text-valign": "center",
      "text-halign": "center",
      "text-margin-x": "data(tx)" as unknown as number,
      "text-margin-y": -1,
      "overlay-opacity": 0,
      "min-zoomed-font-size": 5,
    },
  },
  { selector: "node.external", style: { color: p.muted } },
  { selector: "node.hover", style: { "background-image": "data(imgHover)" } },
  { selector: "node.path", style: { "background-image": "data(imgPath)" } },
  { selector: "node.chosen", style: { "background-image": "data(imgChosen)", "text-margin-y": 1 } },
  { selector: "node.path.chosen", style: { "background-image": "data(imgPathChosen)" } },
  {
    selector: "edge",
    style: {
      width: 1,
      "curve-style": "bezier",
      "line-color": p.muted,
      "target-arrow-color": p.muted,
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      opacity: 0.45,
      "overlay-opacity": 0,
      "font-family": SANS,
      "font-size": 10,
      color: p.muted,
      "text-rotation": "autorotate",
      "text-background-color": p.background,
      "text-background-opacity": 1,
      "text-background-padding": "2px",
      "text-background-shape": "roundrectangle",
    },
  },
  { selector: 'edge[type = "CONTAINS"], edge[type = "DEFINES"]', style: { "line-style": "dashed", "line-dash-pattern": [4, 3] } },
  { selector: 'edge[type = "REFERENCES"], edge[type = "IMPORTS"]', style: { "line-style": "dotted" } },
  { selector: "edge.near", style: { opacity: 0.9 } },
  { selector: ".faded", style: { opacity: 0.25 } },
  { selector: "node.faded", style: { opacity: 0.4 } },
  { selector: "edge.path", style: { width: 2, "line-color": p.blue, "target-arrow-color": p.blue, color: p.blue, opacity: 1, label: "data(label)", "z-index": 10 } },
  { selector: "edge.hover", style: { opacity: 1, label: "data(label)", "z-index": 20 } },
];

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Where to move nodes so no two chips overlap (with `gap` between them), pushing each overlapping pair apart along
 * the axis that needs the shorter move. `fixed` stays put.
 */
function separate(nodes: cytoscape.NodeCollection, fixed?: string, gap = 12): Map<string, Position> {
  const boxes = nodes.map((n) => ({ id: n.id(), x: n.position().x, y: n.position().y, rx: n.width() / 2 + gap / 2, ry: n.height() / 2 + gap / 2 }));
  for (let round = 0; round < 100; round++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const ox = a.rx + b.rx - Math.abs(dx);
        const oy = a.ry + b.ry - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const [ma, mb] = a.id === fixed ? [0, 1] : b.id === fixed ? [1, 0] : [0.5, 0.5];
        if (ox < oy) {
          const push = (dx < 0 ? -1 : 1) * ox;
          a.x -= push * ma;
          b.x += push * mb;
        } else {
          const push = (dy < 0 ? -1 : 1) * oy;
          a.y -= push * ma;
          b.y += push * mb;
        }
      }
    }
    if (!moved) break;
  }
  return new Map(boxes.map((b) => [b.id, { x: b.x, y: b.y }]));
}

/** Positions and viewport from the last time the page was open, so coming back finds the graph as it was left. */
const memory: { positions: Map<string, Position>; viewport?: { zoom: number; pan: Position } } = { positions: new Map() };

export interface GraphCanvasHandle {
  zoomBy(factor: number): void;
  fitAll(): void;
  relayout(): void;
  center(id: string): void;
}

/**
 * The Cytoscape view of `model`. Clicking a node selects it, its badge (or a double click) toggles it, and nodes
 * can be dragged. New nodes start beside a shown neighbor and the layout settles them, keeping `anchor` in place.
 * `focus` asks to bring those nodes into view once they're laid out.
 */
export function GraphCanvas({
  model,
  selected,
  anchor,
  focus,
  onSelect,
  onToggle,
  className,
  ref,
}: {
  model: GraphModel;
  selected?: string;
  anchor?: string;
  focus?: { ids: string[] };
  onSelect: (id: string | undefined) => void;
  onToggle: (id: string) => void;
  className?: string;
  ref?: Ref<GraphCanvasHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [palette, setPalette] = useState<Palette>();
  const layingOut = useRef<cytoscape.Layouts | null>(null);
  const pendingFocus = useRef<{ ids: string[] } | undefined>(undefined);

  const select = useEffectEvent((id: string | undefined) => onSelect(id));
  const toggle = useEffectEvent((id: string) => onToggle(id));
  const currentAnchor = useEffectEvent(() => anchor);

  useEffect(() => {
    let cy: Core | undefined;
    let cancelled = false;
    const observer = new ResizeObserver(() => cy?.resize());
    // Labels are measured in Geist Mono, so wait for it before drawing.
    document.fonts.load(`12px ${MONO}`).finally(() => {
      if (cancelled || !container.current) return;
      const p = readPalette();
      cy = cytoscape({ container: container.current, style: stylesheet(p), minZoom: 0.1, maxZoom: 3, boxSelectionEnabled: false, autounselectify: true });
      const onBadge = (e: EventObject) => {
        const node = e.target as NodeSingular;
        return !!node.data("badge") && e.position.x > node.position().x + node.width() / 2 - PAD - BADGE - GAP / 2;
      };
      cy.on("tap", "node", (e) => (onBadge(e) ? toggle(e.target.id()) : select(e.target.id())));
      cy.on("dbltap", "node", (e) => onBadge(e) || toggle(e.target.id()));
      cy.on("tap", (e) => e.target === cy && select(undefined));
      cy.on("mouseover", "node", (e) => {
        e.target.addClass("hover");
        container.current?.style.setProperty("cursor", "pointer");
      });
      cy.on("mouseout", "node", (e) => {
        e.target.removeClass("hover");
        container.current?.style.removeProperty("cursor");
      });
      cy.on("mouseover", "edge", (e) => e.target.addClass("hover"));
      cy.on("mouseout", "edge", (e) => e.target.removeClass("hover"));
      observer.observe(container.current);
      cyRef.current = cy;
      setPalette(p);
    });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (cy) {
        memory.positions = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
        memory.viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
        cy.destroy();
      }
      cyRef.current = null;
    };
  }, []);

  /** Pans and zooms to `eles`, no closer than MAX_FIT_ZOOM so a few nodes don't fill the screen. */
  const frame = (cy: Core, eles: cytoscape.CollectionReturnValue | cytoscape.NodeCollection) => {
    if (eles.empty()) return;
    const box = eles.boundingBox();
    const pad = 48;
    const zoom = Math.max(cy.minZoom(), Math.min(MAX_FIT_ZOOM, (cy.width() - 2 * pad) / box.w, (cy.height() - 2 * pad) / box.h));
    const pan = { x: cy.width() / 2 - zoom * (box.x1 + box.w / 2), y: cy.height() / 2 - zoom * (box.y1 + box.h / 2) };
    cy.stop();
    if (reducedMotion()) cy.viewport({ zoom, pan });
    else cy.animate({ zoom, pan }, { duration: 300, easing: "ease-out-cubic" });
  };

  const inView = (cy: Core, ids: string[]) => {
    const ext = cy.extent();
    return ids.every((id) => {
      const b = cy.getElementById(id).boundingBox();
      return b.x1 >= ext.x1 && b.x2 <= ext.x2 && b.y1 >= ext.y1 && b.y2 <= ext.y2;
    });
  };

  const applyFocus = (cy: Core) => {
    const want = pendingFocus.current;
    pendingFocus.current = undefined;
    if (!want) return;
    const ids = new Set(want.ids);
    frame(cy, cy.nodes().filter((n) => ids.has(n.id())));
  };

  /** fCoSE, then nudges chips apart where it left them overlapping, then animates every node to its new place. */
  const runLayout = (cy: Core, { randomize, fixed, done }: { randomize: boolean; fixed?: string; done: () => void }) => {
    layingOut.current?.stop();
    const pinned = fixed ? cy.getElementById(fixed) : undefined;
    const start = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
    const force = cy.layout({
      name: "fcose",
      quality: randomize ? "proof" : "default",
      randomize,
      animate: false,
      fit: false,
      nodeDimensionsIncludeLabels: false,
      packComponents: false,
      idealEdgeLength: 70,
      nodeRepulsion: 15000,
      nodeSeparation: 100,
      fixedNodeConstraint: pinned?.nonempty() ? [{ nodeId: fixed, position: { ...pinned.position() } }] : undefined,
    } as LayoutOptions);
    force.one("layoutstop", () => {
      const target = separate(cy.nodes(), fixed);
      cy.nodes().positions((n) => start.get(n.id()) ?? n.position());
      const settle = cy.layout({
        name: "preset",
        positions: (n: NodeSingular) => target.get(n.id())!,
        animate: !reducedMotion(),
        animationDuration: 400,
        animationEasing: "ease-out-cubic",
        fit: false,
      } as LayoutOptions);
      layingOut.current = settle;
      settle.one("layoutstop", () => {
        if (layingOut.current !== settle) return;
        layingOut.current = null;
        done();
      });
      settle.run();
    });
    force.run();
  };

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !palette) return;
    const hidden = hiddenEdges(model);
    const neighbors = new Map<string, string[]>();
    for (const e of model.edges.values()) {
      neighbors.set(e.source, [...(neighbors.get(e.source) ?? []), e.target]);
      neighbors.set(e.target, [...(neighbors.get(e.target) ?? []), e.source]);
    }
    const added: string[] = [];
    let remembered = 0;
    const startAt = (id: string): Position => {
      const known = memory.positions.get(id);
      if (known) {
        remembered++;
        return known;
      }
      const angle = Math.random() * 2 * Math.PI;
      const near = neighbors.get(id)?.map((n) => cy.getElementById(n)).find((n) => n.nonempty());
      if (near) return { x: near.position().x + 120 * Math.cos(angle), y: near.position().y + 80 * Math.sin(angle) };
      const ext = cy.extent();
      return { x: (ext.x1 + ext.x2) / 2 + 40 * Math.cos(angle), y: (ext.y1 + ext.y2) / 2 + 40 * Math.sin(angle) };
    };
    cy.batch(() => {
      cy.elements()
        .filter((el) => (el.isNode() ? !model.nodes.has(el.id()) : !model.edges.has(el.id())))
        .remove();
      for (const [id, { node }] of model.nodes) {
        const badge: Badge = model.expanded.has(id) ? "collapse" : (hidden.get(id) ?? 0) > 0 ? "expand" : null;
        const data = nodeData(palette, node, badge);
        const el = cy.getElementById(id);
        if (el.nonempty()) {
          if (el.data("img") !== data.img || el.data("label") !== data.label) el.data(data);
        } else {
          cy.add({ group: "nodes", data, position: startAt(id), classes: node.external ? "external" : undefined });
          added.push(id);
        }
      }
      for (const [id, e] of model.edges) {
        if (cy.getElementById(id).empty()) cy.add({ group: "edges", data: { id, source: e.source, target: e.target, type: e.type, label: EDGE_WORD[e.type] } });
      }
      cy.elements().removeClass("path faded");
      if (model.path) {
        const on = new Set([...model.path.nodes, ...model.path.edges]);
        cy.elements().forEach((el) => {
          el.addClass(on.has(el.id()) ? "path" : "faded");
        });
      }
    });
    if (remembered > 0 && remembered === added.length && memory.viewport) {
      // Back on the page: everything is where it was left.
      cy.viewport(memory.viewport);
      memory.positions.clear();
      return;
    }
    memory.positions.clear();
    if (added.length === 0) {
      if (!layingOut.current) applyFocus(cy);
      return;
    }
    const fixed = currentAnchor();
    runLayout(cy, {
      // A graph that's all new gets a full layout; otherwise the shown nodes keep roughly where they are.
      randomize: added.length === cy.nodes().length,
      fixed: fixed && !added.includes(fixed) ? fixed : undefined,
      done: () => {
        if (pendingFocus.current) applyFocus(cy);
        else if (!inView(cy, added)) {
          const near = new Set([...added, fixed]);
          frame(cy, cy.nodes().filter((n) => near.has(n.id())));
        }
      },
    });
  }, [palette, model]);

  useEffect(() => {
    if (!focus) return;
    pendingFocus.current = focus;
    const cy = cyRef.current;
    if (cy && palette && !layingOut.current) applyFocus(cy);
  }, [focus, palette]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !palette) return;
    cy.batch(() => {
      cy.nodes().removeClass("chosen");
      cy.edges().removeClass("near");
      if (!selected) return;
      const node = cy.getElementById(selected);
      node.addClass("chosen");
      node.connectedEdges().addClass("near");
    });
  }, [selected, model, palette]);

  useImperativeHandle(ref, () => ({
    zoomBy(factor) {
      const cy = cyRef.current;
      if (!cy) return;
      const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
      const renderedPosition = { x: cy.width() / 2, y: cy.height() / 2 };
      cy.stop();
      if (reducedMotion()) cy.zoom({ level, renderedPosition });
      else cy.animate({ zoom: { level, renderedPosition } } as never, { duration: 150 });
    },
    fitAll() {
      const cy = cyRef.current;
      if (cy) frame(cy, cy.elements());
    },
    relayout() {
      const cy = cyRef.current;
      if (cy && cy.nodes().nonempty()) runLayout(cy, { randomize: true, done: () => frame(cy, cy.elements()) });
    },
    center(id) {
      const cy = cyRef.current;
      const node = cy?.getElementById(id);
      if (!cy || !node || node.empty()) return;
      cy.stop();
      if (reducedMotion()) cy.center(node);
      else cy.animate({ center: { eles: node } }, { duration: 250, easing: "ease-out-cubic" });
    },
  }));

  // Cytoscape makes its container `position: relative`, so the container fills a positioned wrapper.
  return (
    <div className={cn("absolute inset-0", className)}>
      <div ref={container} className="size-full" />
    </div>
  );
}
