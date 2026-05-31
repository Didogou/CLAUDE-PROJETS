import { Settings } from 'lucide-react';
import { ComingSoon } from '@/components/admin/ComingSoon';

export const dynamic = 'force-dynamic';

export default function AdminComptePage() {
  return (
    <ComingSoon
      title="Compte"
      icon={Settings}
      description="Profil Karine (photo, bio, slogan), connexion Stripe, gestion des admins autorisés, sécurité."
    />
  );
}
