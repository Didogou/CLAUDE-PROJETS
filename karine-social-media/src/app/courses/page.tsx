import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/garde/AppHeader';
import { BottomNav } from '@/components/garde/BottomNav';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { ShoppingListPage } from '@/components/courses/ShoppingListPage';
import { getCurrentUser } from '@/lib/current-user';
import { getOrCreateActiveList } from '@/lib/shopping-lists';
import { getCachedPublishedMenus } from '@/lib/cached-content';
import { createServiceClient } from '@/lib/supabase/server';
import { quickMatchCiqual, type CiqualFoodLite } from '@/lib/nutriscore-aggregate';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user.isAuthenticated || !user.id) {
    redirect('/login?next=/courses');
  }

  const [list, menus] = await Promise.all([
    getOrCreateActiveList(user.id),
    getCachedPublishedMenus(),
  ]);

  // Cover du menu de la semaine = le menu publié le plus récent
  const currentMenu = menus[0] ?? null;

  // Vignettes Ciqual à GAUCHE de chaque article : on résout le label de
  // l'article vers un aliment Ciqual (matcher partagé, mêmes règles que
  // recettes/menus) puis on récupère son image. L'article hérite ainsi de
  // l'image de l'ingrédient lié à une recette / un menu.
  let itemImageEntries: Array<[string, string]> = [];
  if (list.items.length > 0) {
    const supa = createServiceClient() as any;
    const foods: CiqualFoodLite[] = [];
    const imgByCode = new Map<number, string>();
    for (let offset = 0; offset < 10000; offset += 1000) {
      const { data } = await supa
        .from('ciqual_foods')
        .select('id, alim_code, name, image_url')
        .order('id', { ascending: true })
        .range(offset, offset + 999);
      const arr = (data ?? []) as Array<{
        id: number;
        alim_code: number;
        name: string;
        image_url: string | null;
      }>;
      if (arr.length === 0) break;
      for (const r of arr) {
        foods.push({ id: Number(r.id), alim_code: Number(r.alim_code), name: String(r.name) } as CiqualFoodLite);
        if (r.image_url) imgByCode.set(Number(r.alim_code), r.image_url);
      }
      if (arr.length < 1000) break;
    }
    for (const it of list.items) {
      const m = quickMatchCiqual(it.label, foods);
      const url = m ? imgByCode.get(m.alim_code) : undefined;
      if (url) itemImageEntries.push([it.key, url]);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      {/* FloralBackground et AppHeader DOIVENT être enfants directs du
          flex parent pour que `sticky top-0` du header reste actif tout
          au long du scroll. Avant : ils étaient dans un wrapper
          print:hidden qui scopait le sticky → l'header décollait dès
          qu'on dépassait sa propre hauteur (~80 px). On garde le
          print:hidden directement sur chaque enfant. */}
      <FloralBackground />
      {/* Meme pattern que /recettes /menus /astuces : pageTitle +
          backHref vers la page d'origine (home par default). Pas de
          bouton "Historique" visible — accessible via le lien
          discret dans la boite pliable "Repas du menu" si besoin. */}
      <AppHeader pageTitle="Mes courses" backHref="/" />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-2xl print:max-w-none print:px-0 print:pb-0">
        <ShoppingListPage
          initialList={list}
          currentMenu={currentMenu}
          itemImages={itemImageEntries}
        />
      </main>
      <div className="print:hidden">
        <BottomNav />
      </div>
      <style>{`
        @media print {
          @page { margin: 1.2cm; }
          html, body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
