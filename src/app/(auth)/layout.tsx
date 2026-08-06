export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 size-96 rounded-full bg-primary/20 blur-3xl"
      />
      <div className="relative z-10 w-full max-w-md">{children}</div>
    </div>
  );
}
