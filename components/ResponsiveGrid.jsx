// Responsive card grid: 1 column on mobile, 2 on tablet (md),
// 3 on desktop (lg). `compact` allows a 4th column on very wide screens
// (xl) only where cards are compact enough to support it.
export default function ResponsiveGrid({ children, compact = false, className = "" }) {
  return (
    <div
      className={`grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 ${
        compact ? "xl:grid-cols-4" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
