import { cn } from "@/lib/utils";

export function Progress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-zinc-800", className)}>
      <div
        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
