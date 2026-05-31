import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { WelcomeBlock } from '@/components/garde/WelcomeBlock';
import { FeatureTile } from '@/components/garde/FeatureTile';
import { MaJourneeCard } from '@/components/garde/MaJourneeCard';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const params = await searchParams;

  // Auto-redirect admin → /admin (sauf si on force la vue abonné via ?as=visitor)
  if (params.as !== 'visitor') {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.role === 'admin') {
        redirect('/admin');
      }
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <FloralBackground />

      {/* Bande haute : logo centré + "Bienvenue" aligné verticalement (desktop) */}
      <div className="relative">
        <AppHeader />
        <WelcomeBlock />
      </div>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 lg:max-w-7xl lg:justify-center lg:px-10 lg:pb-4">
        {/* Tuiles à hauteur égale : 2 colonnes mobile, 5 en ligne desktop */}
        <div className="grid auto-rows-fr grid-cols-2 gap-3 lg:grid-cols-5">
          <FeatureTile
            href="/menus"
            bgClass="bg-peach"
            iconImage="/images/icons/ms.png"
            title="Menu de la semaine"
            subtitle={'Des repas équilibrés\nchaque jour'}
          />
          <FeatureTile
            href="/recettes"
            bgClass="bg-cream"
            iconImage="/images/icons/ir.png"
            title="Idées recettes"
            subtitle={'Inspiration saine\net gourmande'}
          />
          <FeatureTile
            href="/mon-menu"
            bgClass="bg-petal"
            iconImage="/images/icons/mp.png"
            title="Mon menu"
            subtitle={'Adapté à vos besoins\net objectifs'}
            badge="Nouveau"
            accentImage="/images/exclamations.png"
          />
          <FeatureTile
            href="/conseils"
            bgClass="bg-mint"
            iconImage="/images/icons/cs.png"
            title="Conseils santé"
            subtitle={'Mieux comprendre\nvotre santé'}
          />
          <FeatureTile
            href="/astuces"
            bgClass="bg-lavender"
            iconImage="/images/icons/ad.png"
            title="Astuces diététiques"
            subtitle={'Des astuces simples\nau quotidien'}
          />
        </div>

        <div className="mt-3 lg:mt-4">
          <MaJourneeCard />
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
