import { Menu, Bell } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between px-5 py-3 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Ouvrir le menu"
        className="grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-white/60"
      >
        <Menu className="h-6 w-6" strokeWidth={2} />
      </button>

      <Logo />

      <button
        type="button"
        aria-label="Notifications"
        className="relative grid h-10 w-10 place-items-center rounded-full text-ink transition hover:bg-white/60"
      >
        <Bell className="h-6 w-6" strokeWidth={2} />
        <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-coral text-[0.6rem] font-bold text-white">
          2
        </span>
      </button>
    </header>
  );
}
