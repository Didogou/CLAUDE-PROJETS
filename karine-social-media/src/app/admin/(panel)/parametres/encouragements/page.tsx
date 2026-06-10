import { EncouragementsAdminClient } from '@/components/admin/EncouragementsAdminClient';
import { getAppSettings } from '@/lib/app-settings';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Encouragements calories · Admin',
};

export default async function AdminEncouragementsPage() {
  const settings = await getAppSettings();
  return (
    <EncouragementsAdminClient
      initial={settings.calorieEncouragements}
    />
  );
}
