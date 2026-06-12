import { RecipesMealTestView } from '@/components/admin/RecipesMealTestView';

export const dynamic = 'force-dynamic';

export default function RecipesMealTestPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <RecipesMealTestView />
    </div>
  );
}
