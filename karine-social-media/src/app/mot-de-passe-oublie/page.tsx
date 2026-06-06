import type { Metadata } from 'next';
import { FloralBackground } from '@/components/garde/FloralBackground';
import ForgotPasswordForm from './ForgotPasswordForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mot de passe oublié · Karine Diététique',
};

export default function ForgotPasswordPage() {
  return (
    <>
      <FloralBackground />
      <ForgotPasswordForm />
    </>
  );
}
