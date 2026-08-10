const GRADIENT_ID = "mailpilot-mark-gradient";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={GRADIENT_ID} x1="10%" y1="100%" x2="95%" y2="0%">
          <stop offset="0%" stopColor="#4a0a10" />
          <stop offset="55%" stopColor="#c81321" />
          <stop offset="100%" stopColor="#ff5464" />
        </linearGradient>
      </defs>
      <path d="M 10 96 L 91 3 L 77 19 L 27 82 Z" fill={`url(#${GRADIENT_ID})`} />
      <path d="M 22 12 L 52 12 L 70 50 L 56 63 L 42 40 Z" fill={`url(#${GRADIENT_ID})`} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={className ?? "flex items-center gap-2"}>
      <LogoMark className="h-5 w-5 shrink-0" />
      <span className="text-sm font-extrabold tracking-tight">
        <span className="text-zinc-100">Mail</span>
        <span className="text-red-500">Pilot</span>
      </span>
    </span>
  );
}
