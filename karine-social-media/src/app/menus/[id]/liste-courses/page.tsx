import { notFound } from 'next/navigation';
import { FloralBackground } from '@/components/garde/FloralBackground';
import { BottomNav } from '@/components/garde/BottomNav';
import { MenuDayHeader } from '@/components/menus/MenuDayHeader';
import { ShoppingListView } from '@/components/menus/ShoppingListView';
import { getPublishedMenuById } from '@/lib/menus';
import { formatWeekTitle } from '@/data/menus';

export const dynamic = 'force-dynamic';

export default async function MenuShoppingListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const menu = await getPublishedMenuById(id);
  if (!menu) notFound();

  const items = menu.shoppingListItems ?? [];
  const basePortions = menu.shoppingListPortions ?? 4;
  const hasInteractive = items.length > 0;

  return (
    <div className="relative flex min-h-screen flex-col print:bg-white">
      <FloralBackground />
      <MenuDayHeader backHref={`/menus/${id}/jour`} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-8 lg:max-w-2xl print:m-0 print:max-w-none print:p-0">
        <h1 className="mb-2 text-center font-script text-3xl text-coral lg:text-4xl print:hidden">
          🛒 Liste de courses
        </h1>
        <p className="mb-5 text-center text-sm text-ink-soft print:hidden">
          {menu.title || formatWeekTitle(menu.weekStart)}
        </p>

        {hasInteractive ? (
          <ShoppingListView
            menuId={menu.id}
            items={items}
            basePortions={basePortions}
            imageUrl={menu.shoppingListImageUrl || null}
          />
        ) : (
          <NoListYet imageUrl={menu.shoppingListImageUrl || null} />
        )}
      </main>

      <div className="print:hidden">
        <BottomNav />
      </div>
    </div>
  );
}

function NoListYet({ imageUrl }: { imageUrl: string | null }) {
  return (
    <div className="space-y-4">
      {imageUrl && (
        <img
          src={imageUrl}
          alt="Liste de courses"
          className="w-full rounded-2xl shadow-md"
        />
      )}
      <p className="rounded-2xl bg-cream/70 px-4 py-3 text-center text-sm text-ink-soft">
        La liste interactive n&apos;est pas encore disponible pour ce menu.
        Karine la prépare !
      </p>
    </div>
  );
}
