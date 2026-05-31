import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { Leaf } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function ConseilsPage() {
  return (
    <div className="relative flex min-h-screen flex-col">
      <FloralBackground />
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-md xl:max-w-lg">
        <h1 className="mb-5 font-script text-4xl text-coral lg:text-5xl">Conseils</h1>
        <div className="rounded-2xl bg-white/85 px-6 py-10 text-center shadow-sm">
          <Leaf className="mx-auto mb-3 h-10 w-10 text-coral" />
          <p className="text-sm font-semibold text-ink">Bientôt disponible</p>
          <p className="mt-1 text-xs text-ink-soft">
            Karine prépare ses conseils diététiques pour vous accompagner au quotidien.
          </p>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
