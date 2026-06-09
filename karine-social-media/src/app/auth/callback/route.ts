import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/lib/safe-redirect';

// Endpoint appelé par Supabase après clic sur un lien magique d'email
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Anti open redirect : safeNextPath rejette les URLs absolues,
  // protocol-relative (//evil.com), user-info (/@evil.com), backslash.
  const redirect = safeNextPath(searchParams.get('redirect'), '/');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirect}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
