import { Heart } from 'lucide-react';

export function WelcomeBanner() {
  return (
    <div className="px-5 pb-2 pt-1">
      <div className="flex items-end gap-2">
        <h1 className="font-script text-5xl text-ink">Bienvenue,</h1>
        <Heart className="mb-2 h-6 w-6 fill-coral text-coral" />
      </div>
      <p className="font-script text-4xl text-coral">prenons soin de vous !</p>
    </div>
  );
}
