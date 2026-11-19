import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge our custom `shadow-raised`, so a later `shadow-none` overrides it, and `ring-raised`, so it
// replaces the button base's `ring-[3px]`.
const twMerge = extendTailwindMerge({
  extend: { theme: { shadow: ["raised", "raised-focus"] }, classGroups: { "ring-w": [{ ring: ["raised", "raised-primary"] }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
