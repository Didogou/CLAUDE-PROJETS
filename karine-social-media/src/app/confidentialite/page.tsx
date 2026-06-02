import { Blank, LegalLayout } from '@/components/garde/LegalLayout';
import { getPublicLegalSettings } from '@/lib/legal-settings';

export const metadata = { title: 'Politique de confidentialité — Karine Diététique' };

export default async function ConfidentialitePage() {
  const s = await getPublicLegalSettings();
  return (
    <LegalLayout title="Politique de confidentialité" lastUpdated="2 juin 2026">
      <p>
        La présente politique décrit la manière dont <Blank value={s.companyName} placeholder="NOM SOCIÉTÉ" />{' '}
        (« nous ») collecte, utilise et protège vos données personnelles dans
        le cadre de l&apos;utilisation du service en ligne{' '}
        <strong>karine-social-media.vercel.app</strong> (« le Service »), en
        conformité avec le Règlement Général sur la Protection des Données
        (RGPD) et la loi Informatique et Libertés modifiée.
      </p>

      <h2>1. Responsable du traitement</h2>
      <p>
        <Blank value={s.companyName} placeholder="NOM SOCIÉTÉ" />, <Blank value={s.siegeSocial} placeholder="ADRESSE" />, SIRET{' '}
        <Blank value={s.siret} placeholder="NUMÉRO" />.<br />
        Contact&nbsp;: <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" />.
      </p>

      <h2>2. Données collectées</h2>
      <h3>2.1 Données fournies directement</h3>
      <ul>
        <li>Lors de la création de compte&nbsp;: adresse email, mot de passe (chiffré), nom complet (optionnel).</li>
        <li>Lors d&apos;une souscription&nbsp;: informations de facturation traitées par Stripe (nous ne stockons aucune donnée bancaire).</li>
        <li>Lors d&apos;une demande d&apos;accès patiente&nbsp;: votre message à la diététicienne.</li>
        <li>Lors d&apos;une soumission d&apos;idée&nbsp;: titre et contenu de votre proposition.</li>
        <li>Lors de la publication d&apos;un commentaire ou d&apos;une photo : votre contribution.</li>
      </ul>
      <h3>2.2 Données collectées automatiquement</h3>
      <ul>
        <li>Cookies techniques nécessaires à l&apos;authentification (Supabase Auth).</li>
        <li>Données de connexion (date, type de navigateur, adresse IP partielle) à des fins de sécurité et de prévention de la fraude.</li>
      </ul>

      <h2>3. Finalités du traitement</h2>
      <ul>
        <li>Gestion de votre compte et de votre abonnement&nbsp;;</li>
        <li>Fourniture du Service (accès aux contenus, personnalisation)&nbsp;;</li>
        <li>Traitement des paiements via Stripe&nbsp;;</li>
        <li>Envoi des emails transactionnels (bienvenue, confirmation, réponse à une idée) via Resend&nbsp;;</li>
        <li>Mesure d&apos;audience anonymisée du Service&nbsp;;</li>
        <li>Respect de nos obligations légales et comptables.</li>
      </ul>

      <h2>4. Base légale</h2>
      <ul>
        <li>Exécution du contrat (CGU + CGV) que vous avez accepté.</li>
        <li>Consentement pour les cookies non essentiels et les communications marketing optionnelles.</li>
        <li>Obligation légale pour la conservation des factures (10 ans).</li>
        <li>Intérêt légitime pour la sécurité du Service.</li>
      </ul>

      <h2>5. Sous-traitants et destinataires</h2>
      <p>Vos données sont susceptibles d&apos;être traitées par&nbsp;:</p>
      <ul>
        <li><strong>Vercel Inc.</strong> (hébergement) — États-Unis, certifié EU-US Data Privacy Framework.</li>
        <li><strong>Supabase Inc.</strong> (base de données et authentification) — Singapour / UE selon région.</li>
        <li><strong>Stripe Inc.</strong> (traitement des paiements) — Irlande pour l&apos;UE.</li>
        <li><strong>Resend Inc.</strong> (envoi d&apos;emails transactionnels) — États-Unis.</li>
      </ul>
      <p>
        Tous ces sous-traitants ont signé des engagements contractuels
        garantissant un niveau de protection des données équivalent au RGPD.
      </p>

      <h2>6. Durée de conservation</h2>
      <ul>
        <li>Compte actif&nbsp;: pendant toute la durée de votre relation contractuelle.</li>
        <li>Compte inactif depuis 3 ans&nbsp;: suppression ou anonymisation.</li>
        <li>Données de facturation&nbsp;: 10 ans (obligation comptable).</li>
        <li>Logs de connexion&nbsp;: 12 mois maximum.</li>
      </ul>

      <h2>7. Vos droits</h2>
      <p>Conformément au RGPD, vous disposez à tout moment des droits suivants&nbsp;:</p>
      <ul>
        <li><strong>Accès</strong> aux données vous concernant ;</li>
        <li><strong>Rectification</strong> de données inexactes ;</li>
        <li><strong>Suppression</strong> («&nbsp;droit à l&apos;oubli&nbsp;») ;</li>
        <li><strong>Limitation</strong> du traitement ;</li>
        <li><strong>Portabilité</strong> de vos données ;</li>
        <li><strong>Opposition</strong> au traitement à des fins de prospection ;</li>
        <li><strong>Retrait du consentement</strong> à tout moment.</li>
      </ul>
      <p>
        Pour exercer ces droits, contactez-nous à&nbsp;:
        <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" />. Nous répondrons dans un
        délai d&apos;un mois.
      </p>
      <p>
        Vous disposez également du droit d&apos;introduire une réclamation
        auprès de la <strong>CNIL</strong> (cnil.fr).
      </p>

      <h2>8. Cookies</h2>
      <p>
        Le Service utilise uniquement des cookies <strong>strictement
        nécessaires</strong> à son fonctionnement (authentification Supabase).
        Aucun cookie de tracking publicitaire n&apos;est déposé sans votre
        consentement.
      </p>

      <h2>9. Sécurité</h2>
      <p>
        Nous mettons en œuvre des mesures techniques et organisationnelles
        appropriées pour protéger vos données&nbsp;: chiffrement HTTPS,
        hachage des mots de passe (Argon2 via Supabase), accès restreints, RLS
        (Row-Level Security) sur la base de données, journalisation des
        accès.
      </p>

      <h2>10. Modification de la politique</h2>
      <p>
        Cette politique peut être modifiée à tout moment. Les utilisatrices
        seront informées par email en cas de modification substantielle.
      </p>
    </LegalLayout>
  );
}
