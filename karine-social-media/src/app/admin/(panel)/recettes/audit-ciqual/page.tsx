import { AuditCiqualClient } from '@/components/admin/AuditCiqualClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Audit Ciqual · Admin',
};

/**
 * Page admin /admin/recettes/audit-ciqual.
 *
 * Boucle Mistral séquentielle (1 req/s) qui demande à l'IA pour
 * chaque ingrédient si son match Ciqual est cohérent. Le client fait
 * tout le travail : il appelle la route GET pour charger la liste,
 * puis itère en appelant POST /judge pour chaque ligne.
 */
export default function AdminAuditCiqualPage() {
  return <AuditCiqualClient />;
}
