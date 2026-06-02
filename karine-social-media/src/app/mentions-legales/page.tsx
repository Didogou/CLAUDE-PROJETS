import { Blank, LegalLayout } from '@/components/garde/LegalLayout';
import { getPublicLegalSettings } from '@/lib/legal-settings';

export const metadata = { title: 'Mentions légales — Karine Diététique' };

export default async function MentionsLegalesPage() {
  const s = await getPublicLegalSettings();

  return (
    <LegalLayout title="Mentions légales" lastUpdated="2 juin 2026">
      <h2>1. Éditeur du site</h2>
      <p>
        Le site et l&apos;application <strong>karine-social-media.vercel.app</strong>{' '}
        (ci-après « le Service ») sont édités par&nbsp;:
      </p>
      <ul>
        <li>Raison sociale : <Blank value={s.companyName} placeholder="NOM SOCIÉTÉ" /></li>
        <li>Forme juridique : <Blank value={s.legalForm} placeholder="SAS / SARL / Auto-entrepreneur" /></li>
        <li>Capital social : <Blank value={s.capitalSocial} placeholder="MONTANT" /> €</li>
        <li>Siège social : <Blank value={s.siegeSocial} placeholder="ADRESSE COMPLÈTE" /></li>
        <li>RCS : <Blank value={s.rcsCity} placeholder="VILLE" /> n° <Blank value={s.rcsNumber} placeholder="NUMÉRO RCS" /></li>
        <li>SIRET : <Blank value={s.siret} placeholder="14 CHIFFRES" /></li>
        <li>N° TVA intracommunautaire : <Blank value={s.vatNumber} placeholder="FR XX XXX XXX XXX" /></li>
        <li>Email : <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" /></li>
      </ul>

      <h2>2. Directeur de la publication</h2>
      <p>
        <Blank value={s.directorName} placeholder="PRÉNOM NOM" />, en qualité de{' '}
        <Blank value={s.directorFunction} placeholder="FONCTION" />.
      </p>

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
        propriété exclusive de <Blank value={s.companyName} placeholder="NOM SOCIÉTÉ" /> ou
        de leurs ayants droit respectifs. Toute reproduction, représentation ou
        diffusion, totale ou partielle, sans autorisation écrite préalable, est
        interdite et constituerait une contrefaçon sanctionnée par les articles
        L.335-2 et suivants du Code de la propriété intellectuelle.
      </p>

      <h2>5. Contact</h2>
      <p>
        Pour toute question relative au présent site, vous pouvez contacter
        l&apos;éditeur à l&apos;adresse&nbsp;: <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" />.
      </p>
    </LegalLayout>
  );
}
