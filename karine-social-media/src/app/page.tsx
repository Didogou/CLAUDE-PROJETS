import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-4xl md:text-5xl font-bold text-[#2E7D5E]">
          Karine Diététique
        </h1>
        <p className="text-lg text-gray-700">
          Vos menus, recettes, conseils et astuces — accessibles partout, à tout moment.
        </p>
        <p className="text-base text-gray-500">
          Plaisir, variété, équilibre et santé.
        </p>

        <div className="pt-6 flex flex-col sm:flex-row gap-3 justify-center">
          {user ? (
            <>
              <Link
                href="/admin"
                className="px-6 py-3 bg-[#2E7D5E] text-white rounded-md hover:bg-[#1f5a44] transition"
              >
                Espace admin
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="px-6 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition"
                >
                  Se déconnecter
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="px-6 py-3 bg-[#2E7D5E] text-white rounded-md hover:bg-[#1f5a44] transition"
            >
              Se connecter
            </Link>
          )}
        </div>

        {user && (
          <p className="text-sm text-gray-400 pt-4">
            Connecté : <span className="font-mono">{user.email}</span>
          </p>
        )}
      </div>
    </main>
  );
}
