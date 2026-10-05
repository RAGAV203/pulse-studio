export function PageHeader({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 pt-5 pb-4 md:pt-7">
      <div>
        {kicker && <div className="label mb-1 text-cyan/80">{kicker}</div>}
        <h1 className="font-display text-2xl font-bold tracking-wide md:text-3xl">
          <span className="neon-text">{title}</span>
        </h1>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
