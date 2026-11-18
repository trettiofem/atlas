import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TunnelOptions = {
  /** Size of the tunnel's end wall on screen, in px. It stays empty. */
  end?: { width: number; height: number };
  /** Lines running into the distance across the floor and ceiling. */
  columns?: number;
  /** Lines running into the distance up each wall. */
  rows?: number;
  /** Camera distance from the end wall, in px. Lower is a steeper, shorter tunnel. */
  depth?: number;
};

/**
 * A one-point-perspective wireframe tunnel filling its positioned parent, with the vanishing point at
 * `anchor`'s center. Floor cells are square in 3D, so the cross-lines bunch up toward the end.
 */
export function Tunnel({
  anchor,
  end = { width: 640, height: 480 },
  columns = 16,
  rows = 12,
  depth = 640,
  className,
}: TunnelOptions & { anchor: RefObject<HTMLElement | null>; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number; x: number; y: number }>();

  useLayoutEffect(() => {
    const measure = () => {
      if (!svg.current || !anchor.current) return;
      const box = svg.current.getBoundingClientRect();
      const a = anchor.current.getBoundingClientRect();
      setFrame({
        width: box.width,
        height: box.height,
        x: a.left + a.width / 2 - box.left,
        y: a.top + a.height / 2 - box.top,
      });
    };
    const observer = new ResizeObserver(measure);
    if (svg.current) observer.observe(svg.current);
    if (anchor.current) observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [anchor]);

  return (
    <svg ref={svg} aria-hidden className={cn("pointer-events-none absolute inset-0 size-full", className)}>
      {frame && (
        <path
          d={tunnelPath(frame, { end, columns, rows, depth })}
          fill="none"
          strokeWidth={1}
          className="stroke-neutral-67"
        />
      )}
    </svg>
  );
}

function tunnelPath(
  { width, height, x, y }: { width: number; height: number; x: number; y: number },
  { end, columns, rows, depth }: Required<TunnelOptions>,
) {
  const w = end.width / 2;
  const h = end.height / 2;
  // The scale at which a cross-section's sides are all off screen.
  const cover = Math.max(Math.max(x, width - x) / w, Math.max(y, height - y) / h);
  // Half-pixel offsets keep the 1px horizontal and vertical lines crisp.
  const px = (v: number) => Math.round(v - 0.5) + 0.5;
  const d: string[] = [];

  // Cross-sections, one floor cell apart in depth, from the end wall outward.
  const cell = end.width / columns;
  for (let k = 0; k * cell < depth; k++) {
    const s = depth / (depth - k * cell);
    const [l, r, t, b] = [px(x - w * s), px(x + w * s), px(y - h * s), px(y + h * s)];
    d.push(`M${l} ${t}H${r}V${b}H${l}Z`);
    if (s > cover) break;
  }

  // Lines from the end wall's edges toward the viewer, all aimed at the vanishing point.
  const ray = (dx: number, dy: number) => d.push(`M${x + dx} ${y + dy}L${x + dx * cover} ${y + dy * cover}`);
  for (let i = 0; i <= columns; i++) {
    const dx = -w + (2 * w * i) / columns;
    ray(dx, -h);
    ray(dx, h);
  }
  for (let i = 1; i < rows; i++) {
    const dy = -h + (2 * h * i) / rows;
    ray(-w, dy);
    ray(w, dy);
  }
  return d.join("");
}
