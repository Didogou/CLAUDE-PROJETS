import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RecipeForm } from '@/components/admin/RecipeForm';

export const dynamic = 'force-dynamic';

export default function NewRecipePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/admin/recettes"
          aria-label="Retour"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-script text-3xl text-coral">Nouvelle recette</h1>
      </div>
      <RecipeForm />
    </main>
  );
}
