import { Heart } from 'lucide-react';
import { Logo } from './Logo';

/**
 * Header de marque partagé par les pages d'authentification (/login, /signup,
 * /mot-de-passe-oublie, /nouveau-mot-de-passe). Logo Karine + slogan court.
 */
export function BrandHeader({ slogan }: { slogan?: string }) {
  return (
    <div className="flex flex-col items-center px-3 pt-6 text-center sm:px-6 sm:pt-8">
      <Logo />
      {slogan !== '' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-coral sm:text-sm">
          <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
          {slogan ?? 'Bien manger, se sentir bien'}
          <Heart className="h-3.5 w-3.5 fill-coral-soft text-coral" />
        </p>
      )}
    </div>
  );
}
