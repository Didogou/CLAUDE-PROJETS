import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTipBySlug } from '@/lib/tips';
import { EditTipForm } from '@/components/admin/EditTipForm';

export const dynamic = 'force-dynamic';

export default async function AdminEditTipPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tip = await getTipBySlug(slug);
  if (!tip) notFound();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/astuces"
          aria-label="Retour"
          className="grid h-10 w-10 place-items-center rounded-full bg-admin-surface text-admin-ink transition hover:bg-admin-soft/40"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Modifier</p>
          <h2 className="truncate font-script text-3xl text-admin-primary-dark">{tip.label}</h2>
        </div>
      </div>

      <EditTipForm tip={tip} />
    </div>
  );
}
