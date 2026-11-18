import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Teach tailwind-merge our custom `shadow-raised`, so a later `shadow-none` overrides it.
const twMerge = extendTailwindMerge({ extend: { theme: { shadow: ["raised"] } } })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
