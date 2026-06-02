import { getProfilesForModeration } from '@/lib/profiles-admin';
import { ModerationView } from '@/components/admin/ModerationView';

export const dynamic = 'force-dynamic';

export default async function AdminModerationPage() {
  const profiles = await getProfilesForModeration();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Communauté
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Modération</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          Mute / unmute une utilisatrice. Une utilisatrice modérée ne peut plus
          aimer, commenter ni soumettre d&apos;idée. Son contenu existant
          reste visible.
        </p>
      </header>

      <ModerationView initial={profiles} />
    </div>
  );
}
