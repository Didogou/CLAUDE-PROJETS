import { NextResponse, type NextRequest } from 'next/server';
import { getVisibleCommentsForTip } from '@/lib/comments';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await ctx.params;
    const comments = await getVisibleCommentsForTip(slug);
    return NextResponse.json({
      comments: comments.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        author: c.authorName,
        text: c.body,
        photos: c.photos,
        likesCount: c.likesCount,
        parentAuthor: c.parentAuthor,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
