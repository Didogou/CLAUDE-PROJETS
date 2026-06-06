import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FloralBackground } from '@/components/garde/FloralBackground';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Créer mon compte · Karine Diététique',
};

export default function SignupPage() {
  return (
    <>
      <FloralBackground />
      <Suspense fallback={null}>
        <SignupForm />
      </Suspense>
    </>
  );
}
