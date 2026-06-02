import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AdviceForm } from '@/components/admin/AdviceForm';

export const dynamic = 'force-dynamic';

export default function NewAdvicePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href="/admin/conseils"
          aria-label="Retour"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/70 text-ink transition hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-script text-3xl text-coral">Nouveau conseil santé</h1>
      </div>
      <AdviceForm />
    </main>
  );
}
