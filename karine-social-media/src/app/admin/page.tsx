import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function AdminHome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/admin');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .single();

  const isAdmin = profile?.role === 'admin';

  return (
    <main className="min-h-screen px-6 py-12 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-[#2E7D5E]">Espace admin</h1>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Se déconnecter
          </button>
        </form>
      </div>

      <div className="p-4 bg-gray-50 border border-gray-200 rounded-md text-sm">
        <p><span className="font-medium">Email :</span> {profile?.email ?? user.email}</p>
        <p><span className="font-medium">Rôle :</span> {profile?.role ?? '(profil non chargé)'}</p>
      </div>

      {!isAdmin ? (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-md space-y-2">
          <h2 className="font-semibold text-amber-900">Compte non admin</h2>
          <p className="text-sm text-amber-800">
            Pour promouvoir ce compte en admin (en local), ouvrez le Studio Supabase et exécutez :
          </p>
          <pre className="mt-2 p-3 bg-white border rounded text-xs overflow-x-auto">
{`UPDATE public.profiles SET role = 'admin' WHERE email = '${profile?.email ?? user.email}';`}
          </pre>
          <p className="text-xs text-amber-700">
            Studio : <Link href="http://127.0.0.1:54423" className="underline">http://127.0.0.1:54423</Link>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(['menus', 'recipes', 'advice', 'tips'] as const).map((kind) => (
            <Link
              key={kind}
              href={`/admin/${kind}`}
              className="p-6 border border-gray-200 rounded-md hover:border-[#2E7D5E] transition"
            >
              <h2 className="text-lg font-semibold capitalize">{kind}</h2>
              <p className="text-sm text-gray-500 mt-1">CRUD à venir (étape suivante)</p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
