import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { createClient } from '@/lib/supabase/server';
import { getMyNotifications } from '@/lib/notifications';
import { NotificationsView } from '@/components/notifications/NotificationsView';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/notifications');

  const notifications = await getMyNotifications(user.id, 100);

  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader pageTitle="Notifications" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-2xl lg:px-10">
        <p className="mb-5 mt-2 text-sm text-ink-soft">
          Nouveaux contenus, réponses à tes commentaires et à tes idées.
        </p>
        <NotificationsView initial={notifications} />
      </main>
      <BottomNav />
    </div>
  );
}
