import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FloralBackground } from '@/components/garde/FloralBackground';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connexion · Karine Diététique',
};

export default function LoginPage() {
  return (
    <>
      <FloralBackground />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </>
  );
}
