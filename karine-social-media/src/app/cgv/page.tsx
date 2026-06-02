import { Blank, LegalLayout } from '@/components/garde/LegalLayout';
import { getPublicLegalSettings } from '@/lib/legal-settings';

export const metadata = { title: 'Conditions générales de vente — Karine Diététique' };

export default async function CgvPage() {
  const s = await getPublicLegalSettings();
  return (
    <LegalLayout title="Conditions générales de vente" lastUpdated="2 juin 2026">
      <p>
        Les présentes Conditions Générales de Vente (« CGV ») régissent les
        souscriptions d&apos;abonnement au service en ligne
        <strong> karine-social-media.vercel.app</strong> édité par{' '}
        <Blank value={s.companyName} placeholder="NOM SOCIÉTÉ" />.
      </p>

      <h2>1. Offre d&apos;abonnement</h2>
      <p>
        L&apos;éditeur propose un abonnement payant donnant accès à
        l&apos;intégralité du contenu du Service (recettes, menus, conseils,
        astuces). Deux formules sont disponibles&nbsp;:
      </p>
      <ul>
        <li><strong>Mensuel</strong> : 8 € TTC par mois, sans engagement de durée ;</li>
        <li><strong>Annuel</strong> : 80 € TTC par an, soit une économie de 16 € par rapport au tarif mensuel.</li>
      </ul>
      <p>
        Les prix sont indiqués toutes taxes comprises (TVA française applicable
        au taux en vigueur). L&apos;éditeur se réserve le droit de modifier ses
        tarifs à tout moment. Les utilisatrices déjà abonnées conservent leur
        tarif jusqu&apos;à la fin de la période en cours.
      </p>

      <h2>2. Paiement</h2>
      <p>
        Les paiements sont sécurisés et traités par <strong>Stripe Inc.</strong>,
        prestataire de services de paiement agréé. L&apos;éditeur ne stocke
        aucune donnée bancaire (numéro de carte, cryptogramme).
      </p>
      <p>
        Les modes de paiement acceptés sont la carte bancaire (Visa, Mastercard,
        American Express) et les portefeuilles électroniques compatibles avec
        Stripe (Apple Pay, Google Pay).
      </p>

      <h2>3. Reconduction automatique</h2>
      <p>
        L&apos;abonnement se renouvelle automatiquement à la fin de chaque
        période (mensuelle ou annuelle) pour une durée identique, jusqu&apos;à
        sa résiliation par l&apos;utilisatrice.
      </p>

      <h2>4. Droit de rétractation</h2>
      <p>
        Conformément à l&apos;article L221-18 du Code de la consommation,
        l&apos;utilisatrice consommatrice dispose d&apos;un délai de
        <strong> 14 jours</strong> à compter de la souscription pour exercer son
        droit de rétractation, sans avoir à motiver sa décision.
      </p>
      <p>
        <strong>Renonciation expresse</strong>&nbsp;: en cochant la case dédiée
        au moment de la souscription, l&apos;utilisatrice demande expressément
        à bénéficier immédiatement du Service et renonce à son droit de
        rétractation dès que l&apos;exécution du Service a commencé, en
        application de l&apos;article L221-28 13° du Code de la consommation.
      </p>
      <p>
        En l&apos;absence de renonciation, la demande de rétractation peut être
        formulée à <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" />.
      </p>

      <h2>5. Résiliation</h2>
      <p>
        L&apos;utilisatrice peut résilier son abonnement à tout moment depuis
        son espace personnel «&nbsp;Mon plan&nbsp;» ou via le portail Stripe.
        La résiliation prend effet à la fin de la période en cours, sans
        remboursement prorata temporis. L&apos;accès au Service est maintenu
        jusqu&apos;à cette date.
      </p>

      <h2>6. Patientes de Karine</h2>
      <p>
        Les patientes suivies par la diététicienne peuvent demander un accès
        gratuit au Service d&apos;une durée de <strong>6 semaines</strong>. La
        validation des demandes relève de la seule décision de la
        diététicienne. Ce statut est gratuit et ne donne lieu à aucune
        souscription payante automatique.
      </p>

      <h2>7. Garantie et responsabilité</h2>
      <p>
        L&apos;éditeur s&apos;engage à fournir un Service conforme à la
        description faite avant souscription. En cas de dysfonctionnement
        majeur du Service ne permettant pas l&apos;accès au contenu pendant
        plus de 48h consécutives, l&apos;éditeur procédera à une prolongation
        de l&apos;abonnement à hauteur de la période d&apos;indisponibilité.
      </p>

      <h2>8. Service après-vente</h2>
      <p>
        Toute réclamation peut être adressée à&nbsp;: <Blank value={s.contactEmail} placeholder="contact@karine-dietetique.fr" />.
        L&apos;éditeur s&apos;engage à apporter une première réponse dans un
        délai maximal de 7 jours ouvrés.
      </p>

      <h2>9. Médiation</h2>
      <p>
        Conformément aux articles L612-1 et suivants du Code de la
        consommation, l&apos;utilisatrice consommatrice peut, en cas de litige
        non résolu, recourir gratuitement à un médiateur de la consommation&nbsp;:
        <Blank value={s.mediatorName} placeholder="NOM ET COORDONNÉES DU MÉDIATEUR" />.
      </p>

      <h2>10. Droit applicable et juridiction</h2>
      <p>
        Les présentes CGV sont régies par le droit français. À défaut de
        résolution amiable, tout litige sera porté devant les tribunaux
        français compétents.
      </p>
    </LegalLayout>
  );
}
