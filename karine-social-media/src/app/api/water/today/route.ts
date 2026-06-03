import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getWaterDayState } from '@/lib/water';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const state = await getWaterDayState(user.id);
  return NextResponse.json(state);
}
