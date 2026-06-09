import { Blank, LegalLayout } from '@/components/garde/LegalLayout';
import { getPublicLegalSettings } from '@/lib/legal-settings';

export const metadata = { title: 'Politique de confidentialité — Karine Diététique' };

export default async function ConfidentialitePage() {
  const s = await getPublicLegalSettings();
  return (
    <LegalLayout title="Politique de confidentialité" lastUpdated="9 juin 2026">
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
        <li>Lors de la création de compte&nbsp;: adresse email, mot de passe (chiffré), nom complet, <strong>date de naissance</strong> (vérification d&apos;âge 15 ans+, Art. 8 RGPD).</li>
        <li>
          <strong>Données de santé</strong> (catégorie spéciale Art. 9 RGPD)&nbsp;:
          poids, taille, sexe, niveau d&apos;activité, objectif (perte ou maintien),
          journal alimentaire. Ces données sont collectées <strong>uniquement avec
          votre consentement explicite</strong> recueilli par une case dédiée
          avant la première saisie. Vous pouvez retirer ce consentement à tout
          moment depuis votre profil&nbsp;; les données concernées sont alors
          immédiatement supprimées.
        </li>
        <li>Lors d&apos;une souscription&nbsp;: informations de facturation traitées par Stripe (nous ne stockons aucune donnée bancaire).</li>
        <li>Lors d&apos;une demande d&apos;accès patiente&nbsp;: votre message à la diététicienne.</li>
        <li>Lors d&apos;une soumission d&apos;idée&nbsp;: titre et contenu de votre proposition.</li>
        <li>Lors de la publication d&apos;un commentaire ou d&apos;une photo&nbsp;: votre contribution.</li>
        <li>
          Lors de l&apos;analyse d&apos;une <strong>photo de repas</strong>&nbsp;: l&apos;image est
          transmise à un service d&apos;intelligence artificielle (Anthropic Claude
          Vision) qui en extrait une description nutritionnelle. La photo n&apos;est
          pas conservée par Anthropic au-delà du temps strictement nécessaire au
          traitement.
        </li>
        <li>
          Lors d&apos;une <strong>saisie en langage naturel</strong> dans le journal
          alimentaire (ex.&nbsp;: «&nbsp;j&apos;ai mangé un yaourt&nbsp;»)&nbsp;: le texte
          est transmis à un service d&apos;intelligence artificielle (Mistral AI)
          pour identification des aliments.
        </li>
      </ul>
      <h3>2.2 Données collectées automatiquement</h3>
      <ul>
        <li>Cookies techniques nécessaires à l&apos;authentification (Supabase Auth).</li>
        <li>Données de connexion (date, type de navigateur, adresse IP partielle) à des fins de sécurité et de prévention de la fraude.</li>
        <li>
          <strong>Données d&apos;usage</strong>&nbsp;: pages consultées, recettes
          et menus visités. Ces données sont conservées pour mesurer l&apos;intérêt
          des contenus et améliorer le service. Elles sont automatiquement
          purgées après 13 mois&nbsp;; le référent (referrer) est anonymisé après
          30 jours.
        </li>
        <li>
          <strong>Vercel SpeedInsights</strong>&nbsp;: mesures techniques
          anonymes de performance (temps de chargement). Aucun identifiant
          personnel n&apos;est collecté par ce service.
        </li>
      </ul>

      <h2>3. Finalités du traitement</h2>
      <ul>
        <li>Gestion de votre compte et de votre abonnement&nbsp;;</li>
        <li>Fourniture du Service (accès aux contenus, personnalisation)&nbsp;;</li>
        <li>Calcul personnalisé de vos besoins nutritionnels à partir de vos données de santé (Art. 9 RGPD)&nbsp;;</li>
        <li>Analyse par intelligence artificielle des photos et descriptions de repas pour identifier les aliments consommés&nbsp;;</li>
        <li>Traitement des paiements via Stripe&nbsp;;</li>
        <li>Envoi des emails transactionnels (bienvenue, confirmation, réponse à une idée) via Resend&nbsp;;</li>
        <li>Mesure d&apos;audience interne du Service (statistiques anonymes par contenu)&nbsp;;</li>
        <li>Respect de nos obligations légales et comptables.</li>
      </ul>

      <h2>4. Base légale</h2>
      <ul>
        <li>Exécution du contrat (CGU + CGV) que vous avez accepté.</li>
        <li>
          <strong>Consentement explicite (Art. 9-2-a RGPD)</strong> pour le
          traitement des données de santé (poids, taille, sexe, objectif perte
          de poids, journal alimentaire, photos de repas).
        </li>
        <li>
          <strong>Consentement explicite (Art. 8 RGPD)</strong> au moment du
          signup pour les utilisatrices de 15 ans et plus. L&apos;application
          n&apos;est pas accessible aux personnes de moins de 15 ans.
        </li>
        <li>Consentement pour les communications marketing optionnelles.</li>
        <li>Obligation légale pour la conservation des factures (10 ans).</li>
        <li>Intérêt légitime pour la sécurité du Service.</li>
      </ul>

      <h2>5. Sous-traitants et destinataires</h2>
      <p>Vos données sont susceptibles d&apos;être traitées par les sous-traitants suivants&nbsp;:</p>
      <ul>
        <li>
          <strong>Vercel Inc.</strong> (hébergement applicatif + mesures
          techniques de performance via SpeedInsights) — États-Unis, certifié
          <em> EU-US Data Privacy Framework</em>. Région serveur configurée sur
          Paris (CDG) pour minimiser les transferts.
        </li>
        <li>
          <strong>Supabase Inc.</strong> (base de données, authentification,
          stockage de fichiers) — Région UE (Francfort).
        </li>
        <li>
          <strong>Stripe Payments Europe Ltd.</strong> (traitement des
          paiements et facturation) — Irlande, sous-traitement par Stripe Inc.
          (États-Unis) couvert par les <em>Clauses Contractuelles Types</em>
          (CCT) approuvées par la Commission européenne.
        </li>
        <li>
          <strong>Resend Inc.</strong> (envoi d&apos;emails transactionnels :
          bienvenue, confirmation, réponse à une idée) — États-Unis.
        </li>
        <li>
          <strong>Anthropic PBC</strong> (analyse par IA Claude Vision des
          photos de repas et des fiches recettes) — États-Unis, certifié
          <em> EU-US Data Privacy Framework</em>. Les photos sont transmises
          pour analyse mais non conservées à long terme par Anthropic.
        </li>
        <li>
          <strong>Mistral AI SAS</strong> (analyse par IA des descriptions de
          repas en langage naturel) — France (Paris).
        </li>
        <li>
          <strong>Google LLC</strong> et <strong>Meta Platforms Inc.</strong>{' '}
          (authentification OAuth optionnelle «&nbsp;Continuer avec
          Google&nbsp;» / «&nbsp;Continuer avec Facebook&nbsp;») — États-Unis,
          certifiés <em>EU-US Data Privacy Framework</em>. Aucune donnée
          n&apos;est transmise sans votre clic explicite sur le bouton
          correspondant.
        </li>
      </ul>
      <p>
        Tous ces sous-traitants ont signé des engagements contractuels
        garantissant un niveau de protection des données équivalent au RGPD.
      </p>

      <h3>5.1 Transferts hors Union européenne</h3>
      <p>
        Certains sous-traitants étant situés aux États-Unis, des transferts de
        données hors UE peuvent avoir lieu. Ces transferts sont encadrés par&nbsp;:
      </p>
      <ul>
        <li>
          la décision d&apos;adéquation du 10 juillet 2023 de la Commission
          européenne (<em>EU-US Data Privacy Framework</em>) pour les sous-traitants
          américains certifiés (Vercel, Anthropic, Google, Meta)&nbsp;;
        </li>
        <li>
          les <em>Clauses Contractuelles Types</em> approuvées par la
          Commission européenne pour les autres transferts.
        </li>
      </ul>
      <p>
        Vous pouvez à tout moment demander des informations sur les garanties
        appliquées en contactant{' '}
        <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" />.
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

      <h2>8. Cookies et traceurs</h2>
      <p>
        Le Service utilise les cookies et traceurs suivants&nbsp;:
      </p>
      <ul>
        <li>
          <strong>Cookies strictement nécessaires</strong> à l&apos;authentification
          et à la sécurité (Supabase Auth). Sans ces cookies, le Service ne peut
          fonctionner.
        </li>
        <li>
          <strong>Mesures de performance Vercel SpeedInsights</strong>&nbsp;:
          collecte anonyme de métriques techniques (temps de chargement, type
          d&apos;appareil). Aucun identifiant personnel n&apos;est associé à ces
          mesures.
        </li>
        <li>
          <strong>Mesure d&apos;audience interne</strong> (table page_views)&nbsp;:
          enregistre les pages que vous consultez pour mesurer l&apos;intérêt
          des contenus. Conservation 13 mois maximum, anonymisation du
          référent après 30 jours.
        </li>
      </ul>
      <p>
        Aucun cookie de tracking publicitaire n&apos;est déposé. Le Service ne
        partage aucune donnée avec des régies publicitaires.
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
