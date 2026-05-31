import { Suspense } from 'react';
import AdminLoginForm from './AdminLoginForm';

export const dynamic = 'force-dynamic';

export default function AdminLoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-admin-bg px-6 py-12">
      <Suspense fallback={null}>
        <AdminLoginForm />
      </Suspense>
    </main>
  );
}
