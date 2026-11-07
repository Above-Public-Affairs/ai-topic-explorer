export default function CloseButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Close"
      className={`shrink-0 -mr-2 size-10 inline-flex items-center justify-center rounded-full text-(--text-tertiary) hover:text-(--text-primary) hover:bg-black/5 transition-colors active:scale-[0.96] ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
