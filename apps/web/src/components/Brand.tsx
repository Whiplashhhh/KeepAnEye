export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--surface-3)" />
      <path
        d="M5.5 16c2.6-4.6 6.1-7 10.5-7s7.9 2.4 10.5 7c-2.6 4.6-6.1 7-10.5 7s-7.9-2.4-10.5-7Z"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.6" fill="var(--accent)" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-tight text-fg">Keep An Eye</span>
    </div>
  );
}
