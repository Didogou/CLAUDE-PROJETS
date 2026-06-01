import { Suspense } from 'react';
import { FloralBackground } from '@/components/garde/FloralBackground';
import SignupForm from './SignupForm';

export const dynamic = 'force-dynamic';

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
