import { Leaf } from 'lucide-react';
import { ComingSoon } from '@/components/admin/ComingSoon';

export const dynamic = 'force-dynamic';

export default function AdminConseilsPage() {
  return (
    <ComingSoon
      title="Conseils santé"
      icon={Leaf}
      description="Publier un conseil diététique (image + texte développé), gérer le calendrier 2-3 par semaine."
    />
  );
}
