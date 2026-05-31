import type { LucideIcon } from 'lucide-react';

export function ComingSoon({
  title,
  icon: Icon,
  description,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
}) {
  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Section</p>
        <h2 className="font-script text-4xl text-admin-primary-dark">{title}</h2>
      </header>
      <div className="rounded-2xl border border-dashed border-admin-border bg-admin-surface px-6 py-12 text-center">
        <Icon className="mx-auto h-10 w-10 text-admin-primary" strokeWidth={1.8} />
        <p className="mt-4 text-sm font-semibold text-admin-ink">Bientôt disponible</p>
        <p className="mt-1 text-sm text-admin-ink-soft">{description}</p>
      </div>
    </div>
  );
}
