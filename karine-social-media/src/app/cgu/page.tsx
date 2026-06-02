import { Blank, LegalLayout } from '@/components/garde/LegalLayout';

export const metadata = { title: 'Conditions générales d’utilisation — Karine Diététique' };
export const dynamic = 'force-static';

export default function CguPage() {
  return (
    <LegalLayout title="Conditions générales d'utilisation" lastUpdated="2 juin 2026">
      <p>
        Les présentes Conditions Générales d&apos;Utilisation (« CGU »)
        régissent l&apos;accès et l&apos;utilisation du service en ligne
        accessible à l&apos;adresse <strong>karine-social-media.vercel.app</strong>
        {' '}(« le Service ») édité par <Blank>NOM SOCIÉTÉ</Blank>.
      </p>
      <p>
        L&apos;utilisation du Service implique l&apos;acceptation pleine et
        entière des présentes CGU. Si vous n&apos;acceptez pas ces conditions,
        vous devez renoncer à utiliser le Service.
      </p>

      <h2>1. Description du Service</h2>
      <p>
        Karine Diététique est une application proposant un contenu éditorial
        autour de la diététique et de la nutrition&nbsp;: recettes, menus
        hebdomadaires, conseils santé et astuces du quotidien rédigés par une
        diététicienne diplômée. Certaines fonctionnalités sont réservées aux
        utilisatrices ayant souscrit un abonnement payant.
      </p>

      <h2>2. Accès au Service</h2>
      <p>
        Le Service est accessible 24h/24, 7j/7 sous réserve des opérations de
        maintenance et des interruptions liées à des cas de force majeure ou à
        des incidents techniques. L&apos;éditeur ne saurait être tenu pour
        responsable des dommages résultant d&apos;une interruption temporaire.
      </p>

      <h2>3. Création de compte</h2>
      <p>
        Pour bénéficier de l&apos;intégralité du Service, l&apos;utilisatrice
        doit créer un compte en fournissant une adresse email valide et un mot
        de passe. Elle s&apos;engage à&nbsp;:
      </p>
      <ul>
        <li>fournir des informations exactes et à jour ;</li>
        <li>conserver la confidentialité de ses identifiants ;</li>
        <li>informer immédiatement l&apos;éditeur de toute utilisation non autorisée de son compte.</li>
      </ul>
      <p>
        L&apos;éditeur se réserve le droit de suspendre ou supprimer tout
        compte en cas de manquement aux présentes CGU, sans préavis.
      </p>

      <h2>4. Abonnement payant</h2>
      <p>
        Les conditions tarifaires, modalités de paiement, durée de
        l&apos;abonnement et droit de rétractation sont détaillés dans les{' '}
        <a href="/cgv" className="font-semibold text-coral hover:underline">Conditions Générales de Vente</a>.
      </p>

      <h2>5. Comportement de l&apos;utilisatrice</h2>
      <p>L&apos;utilisatrice s&apos;engage à ne pas&nbsp;:</p>
      <ul>
        <li>utiliser le Service à des fins illégales, frauduleuses ou contraires aux bonnes mœurs ;</li>
        <li>publier, via les commentaires, les photos ou les idées soumises, du contenu diffamatoire, injurieux, raciste, sexuellement explicite ou portant atteinte à la vie privée d&apos;autrui ;</li>
        <li>tenter d&apos;accéder, sans autorisation, à des parties non publiques du Service ;</li>
        <li>perturber le fonctionnement du Service par toute action automatisée massive.</li>
      </ul>

      <h2>6. Propriété intellectuelle</h2>
      <p>
        L&apos;ensemble du contenu éditorial (recettes, menus, articles, photos,
        logos, code, design) est protégé au titre du droit d&apos;auteur et
        appartient à <Blank>NOM SOCIÉTÉ</Blank> ou à ses ayants droit.
        L&apos;utilisatrice obtient une licence personnelle, non exclusive et
        non transférable d&apos;utilisation pour son usage privé uniquement.
        Toute reproduction, redistribution ou usage commercial est interdit.
      </p>
      <p>
        Le contenu utilisateur (commentaires, photos, idées soumises) reste la
        propriété de l&apos;utilisatrice. Elle concède à l&apos;éditeur une
        licence gratuite, mondiale et non exclusive d&apos;utiliser ce contenu
        dans le cadre du Service.
      </p>

      <h2>7. Avis médical</h2>
      <p>
        Les contenus diffusés sur le Service ont une visée informative et de
        confort. Ils <strong>ne constituent en aucun cas un avis ou une
        prescription médicale</strong>. Avant toute modification importante de
        votre alimentation, notamment en cas de pathologie, de grossesse, ou de
        traitement médical, consultez un professionnel de santé qualifié.
      </p>

      <h2>8. Responsabilité</h2>
      <p>
        L&apos;éditeur ne pourra être tenu responsable des dommages directs ou
        indirects résultant d&apos;une mauvaise utilisation du Service. La
        responsabilité de l&apos;éditeur est limitée au montant des sommes
        effectivement payées par l&apos;utilisatrice sur les 12 derniers mois.
      </p>

      <h2>9. Modification des CGU</h2>
      <p>
        L&apos;éditeur se réserve le droit de modifier les présentes CGU à tout
        moment. Les utilisatrices seront informées par email et/ou notification
        in-app au moins 30 jours avant l&apos;entrée en vigueur des
        modifications substantielles.
      </p>

      <h2>10. Droit applicable et juridiction</h2>
      <p>
        Les présentes CGU sont soumises au droit français. À défaut de
        résolution amiable, tout litige sera porté devant les tribunaux
        compétents de <Blank>VILLE TRIBUNAL</Blank>.
      </p>

      <h2>11. Contact</h2>
      <p>
        Pour toute question relative aux CGU : <Blank>contact@karine-dietetique.fr</Blank>.
      </p>
    </LegalLayout>
  );
}
