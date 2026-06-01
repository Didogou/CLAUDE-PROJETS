import { getAllSubscribers } from '@/lib/subscribers';
import { AbonnesView } from '@/components/admin/AbonnesView';
import { PLANS } from '@/data/plans';

export const dynamic = 'force-dynamic';

export default async function AdminAbonnesPage() {
  const subscribers = await getAllSubscribers();

  const activeCount = subscribers.filter((s) =>
    ['trialing', 'active', 'past_due', 'paused'].includes(s.status ?? ''),
  ).length;
  const cancellingCount = subscribers.filter(
    (s) =>
      s.cancelAtPeriodEnd &&
      ['trialing', 'active', 'past_due'].includes(s.status ?? ''),
  ).length;
  const mrrEUR = subscribers
    .filter((s) =>
      ['trialing', 'active', 'past_due', 'paused'].includes(s.status ?? ''),
    )
    .reduce((sum, s) => {
      if (!s.planKind) return sum;
      const price = PLANS[s.planKind].priceEUR;
      return sum + (s.planKind === 'yearly' ? price / 12 : price);
    }, 0);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Section
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Abonn&eacute;s</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          {subscribers.length} ligne{subscribers.length > 1 ? 's' : ''} d&apos;abonnement
          (historique inclus).
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Actifs" value={activeCount} accent="primary" />
        <StatCard label="En annulation" value={cancellingCount} accent="warn" />
        <StatCard
          label="MRR (test)"
          value={`${mrrEUR.toFixed(2)} €`}
          accent="ok"
        />
      </div>

      <AbonnesView subscribers={subscribers} />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: 'primary' | 'warn' | 'ok';
}) {
  const color =
    accent === 'primary'
      ? 'text-admin-primary-dark'
      : accent === 'warn'
        ? 'text-tangerine'
        : 'text-sage';
  return (
    <div className="rounded-2xl bg-admin-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
