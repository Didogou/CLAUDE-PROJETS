import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNutritionDayState } from '@/lib/nutrition';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }
  const state = await getNutritionDayState(user.id);
  return NextResponse.json(state);
}
