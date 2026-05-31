import { getAllCommentsAdmin } from '@/lib/comments';
import { CommentsModeration } from '@/components/admin/CommentsModeration';

export const dynamic = 'force-dynamic';

export default async function AdminAvisPage() {
  const comments = await getAllCommentsAdmin();

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">Modération</p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Avis</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          {comments.length} avis au total. Vous pouvez supprimer ceux qui ne respectent pas la
          charte.
        </p>
      </header>

      <CommentsModeration
        comments={comments
          .filter((c): c is typeof c & { recipeSlug: string } => c.recipeSlug !== null)
          .map((c) => ({
            id: c.id,
            recipeSlug: c.recipeSlug,
            authorName: c.authorName,
            body: c.body,
            createdAt: c.createdAt,
          }))}
      />
    </div>
  );
}
