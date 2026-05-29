import { CalendarHeart, Salad, HeartHandshake, HeartPulse, Lightbulb } from 'lucide-react';
import { AppHeader } from '@/components/garde/AppHeader';
import { WelcomeBanner } from '@/components/garde/WelcomeBanner';
import { FeatureTile } from '@/components/garde/FeatureTile';
import { MaJourneeCard } from '@/components/garde/MaJourneeCard';
import { BottomNav } from '@/components/garde/BottomNav';

export default function Home() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <AppHeader />

      <main className="flex-1 pb-4">
        <WelcomeBanner />

        {/* Rangée 1 : 3 tuiles compactes */}
        <div className="grid grid-cols-3 gap-3 px-5 pt-2">
          <FeatureTile
            href="/menus"
            icon={CalendarHeart}
            iconClass="text-sage"
            bgClass="bg-peach"
            title="Menu de la semaine"
            subtitle="Des repas équilibrés chaque jour"
            compact
          />
          <FeatureTile
            href="/recettes"
            icon={Salad}
            iconClass="text-tangerine"
            bgClass="bg-cream"
            title="Idées recettes"
            subtitle="Inspiration saine et gourmande"
            compact
          />
          <FeatureTile
            href="/mon-menu"
            icon={HeartHandshake}
            iconClass="text-coral"
            bgClass="bg-petal"
            title="Mon menu personnalisé"
            subtitle="Adapté à vos besoins et objectifs"
            badge="Nouveau"
            compact
          />
        </div>

        {/* Rangée 2 : 2 tuiles larges */}
        <div className="grid grid-cols-2 gap-3 px-5 pt-3">
          <FeatureTile
            href="/conseils"
            icon={HeartPulse}
            iconClass="text-cherry"
            bgClass="bg-cream"
            title="Conseils santé"
            subtitle="Mieux comprendre votre santé"
          />
          <FeatureTile
            href="/astuces"
            icon={Lightbulb}
            iconClass="text-violet-icon"
            bgClass="bg-lavender"
            title="Astuces diététiques"
            subtitle="Des astuces simples au quotidien"
          />
        </div>

        <div className="pt-4">
          <MaJourneeCard />
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
