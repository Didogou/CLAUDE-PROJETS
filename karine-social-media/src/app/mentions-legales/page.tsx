import { Blank, LegalLayout } from '@/components/garde/LegalLayout';

export const metadata = { title: 'Mentions légales — Karine Diététique' };
export const dynamic = 'force-static';

export default function MentionsLegalesPage() {
  return (
    <LegalLayout title="Mentions légales" lastUpdated="2 juin 2026">
      <h2>1. Éditeur du site</h2>
      <p>
        Le site et l&apos;application <strong>karine-social-media.vercel.app</strong>{' '}
        (ci-après « le Service ») sont édités par&nbsp;:
      </p>
      <ul>
        <li>Raison sociale : <Blank>NOM SOCIÉTÉ</Blank></li>
        <li>Forme juridique : <Blank>SAS / SARL / Auto-entrepreneur</Blank></li>
        <li>Capital social : <Blank>MONTANT</Blank> €</li>
        <li>Siège social : <Blank>ADRESSE COMPLÈTE</Blank></li>
        <li>RCS : <Blank>VILLE</Blank> n° <Blank>NUMÉRO RCS</Blank></li>
        <li>SIRET : <Blank>14 CHIFFRES</Blank></li>
        <li>N° TVA intracommunautaire : <Blank>FR XX XXX XXX XXX</Blank></li>
        <li>Email : <Blank>contact@karine-dietetique.fr</Blank></li>
      </ul>

      <h2>2. Directeur de la publication</h2>
      <p><Blank>PRÉNOM NOM</Blank>, en qualité de <Blank>FONCTION</Blank>.</p>

      <h2>3. Hébergeur</h2>
      <p>
        Le Service est hébergé par <strong>Vercel Inc.</strong>, 340 S Lemon Ave
        #4133, Walnut, CA 91789, États-Unis. Site web :
        <a href="https://vercel.com" target="_blank" rel="noreferrer" className="ml-1 font-semibold text-coral hover:underline">vercel.com</a>.
      </p>
      <p>
        La base de données et l&apos;authentification sont gérées par
        <strong> Supabase Inc.</strong>, 970 Toa Payoh North #07-04, Singapour
        318992.
      </p>

      <h2>4. Propriété intellectuelle</h2>
      <p>
        L&apos;ensemble des contenus présents sur le Service (textes, images,
        photographies, vidéos, recettes, illustrations, logos, marques) sont la
        propriété exclusive de <Blank>NOM SOCIÉTÉ</Blank> ou de leurs ayants
        droit respectifs. Toute reproduction, représentation ou diffusion, totale
        ou partielle, sans autorisation écrite préalable, est interdite et
        constituerait une contrefaçon sanctionnée par les articles L.335-2 et
        suivants du Code de la propriété intellectuelle.
      </p>

      <h2>5. Contact</h2>
      <p>
        Pour toute question relative au présent site, vous pouvez contacter
        l&apos;éditeur à l&apos;adresse&nbsp;: <Blank>contact@karine-dietetique.fr</Blank>.
      </p>
    </LegalLayout>
  );
}
