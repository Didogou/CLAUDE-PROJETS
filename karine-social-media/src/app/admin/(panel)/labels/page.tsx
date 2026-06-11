import { DietaryAuditView } from '@/components/admin/DietaryAuditView';

export const dynamic = 'force-dynamic';

export default function LabelsAuditPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <DietaryAuditView />
    </div>
  );
}
