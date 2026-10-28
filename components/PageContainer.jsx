// Wide responsive app container. Replaces the old 768px (max-w-3xl) shell
// for main content: full width up to 1280px, with fluid side padding.
// Narrow max-w utilities are still used inside it for auth forms.
export default function PageContainer({ children, className = "" }) {
  return (
    <div
      className={`mx-auto w-full min-w-0 max-w-[1280px] px-[clamp(16px,3vw,40px)] ${className}`}
    >
      {children}
    </div>
  );
}
