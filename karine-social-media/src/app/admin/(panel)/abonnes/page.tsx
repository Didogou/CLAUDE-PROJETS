import { Users } from 'lucide-react';
import { ComingSoon } from '@/components/admin/ComingSoon';

export const dynamic = 'force-dynamic';

export default function AdminAbonnesPage() {
  return (
    <ComingSoon
      title="Abonnés"
      icon={Users}
      description="Liste des abonnés, statut (essai/actif/résilié), MRR par abonné. Dépend de Stripe Connect."
    />
  );
}
