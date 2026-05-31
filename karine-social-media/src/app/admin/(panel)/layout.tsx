import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AdminChrome } from '@/components/admin/AdminChrome';

export const dynamic = 'force-dynamic';

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') {
    redirect('/?notice=not-admin');
  }

  return <AdminChrome>{children}</AdminChrome>;
}
