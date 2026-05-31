import { Heart } from 'lucide-react';

export function WelcomeBlock() {
  return (
    <div className="px-5 pb-3 pt-1 lg:absolute lg:inset-y-0 lg:left-28 lg:flex lg:flex-col lg:justify-center lg:p-0">
      <div className="flex items-end gap-3">
        <h1 className="text-3xl font-extrabold text-ink lg:text-4xl">Bienvenue,</h1>
        <Heart className="mb-1 h-6 w-6 text-coral" strokeWidth={2} />
      </div>
      <p className="mt-1 font-script text-3xl leading-tight text-coral lg:text-4xl">
        prenons soin de vous !
      </p>
    </div>
  );
}
