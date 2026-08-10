"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { progressBarTransition } from "@/utils/motion";

export function Progress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value)) / 100;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}>
      <motion.div
        className="h-full w-full origin-left rounded-full bg-emerald-500"
        initial={false}
        animate={{ scaleX: clamped }}
        transition={progressBarTransition}
      />
    </div>
  );
}
