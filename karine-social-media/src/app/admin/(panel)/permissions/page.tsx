import { getAllPagePermissions } from '@/lib/page-permissions';
import { discoverPages } from '@/lib/discover-pages';
import { ALL_ROLES, type AppRole } from '@/data/roles';
import { PermissionsView, type PermissionRow } from '@/components/admin/PermissionsView';

export const dynamic = 'force-dynamic';

export default async function AdminPermissionsPage() {
  const [discovered, dbPermissions] = await Promise.all([
    Promise.resolve(discoverPages()),
    getAllPagePermissions(),
  ]);

  const byPath = new Map(dbPermissions.map((p) => [p.path, p]));

  // Merge : pour chaque page découverte → on récupère sa règle DB si existe,
  // sinon défaut (tous rôles autorisés, label = défaut généré du chemin).
  const merged: PermissionRow[] = discovered.map((d) => {
    const db = byPath.get(d.path);
    return {
      path: d.path,
      label: db?.description ?? d.defaultLabel,
      allowedRoles: db?.allowedRoles ?? [...ALL_ROLES],
      hasDbRow: !!db,
      dynamic: d.dynamic,
    };
  });

  // On ajoute aussi les règles DB qui ne correspondent à aucune page découverte
  // (cas : chemin manuel ou page supprimée). On les marque comme "orphelines".
  const discoveredPaths = new Set(discovered.map((d) => d.path));
  for (const db of dbPermissions) {
    if (!discoveredPaths.has(db.path)) {
      merged.push({
        path: db.path,
        label: db.description ?? db.path,
        allowedRoles: db.allowedRoles as AppRole[],
        hasDbRow: true,
        orphan: true,
      });
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-admin-primary">
          Acc&egrave;s
        </p>
        <h2 className="font-script text-4xl text-admin-primary-dark">Permissions par page</h2>
        <p className="mt-1 text-sm text-admin-ink-soft">
          La liste ci-dessous est g&eacute;n&eacute;r&eacute;e automatiquement
          depuis les pages du site. Nomme chaque page (visible par Karine), puis
          coche qui peut y acc&eacute;der.
        </p>
      </header>

      <div className="rounded-2xl border border-admin-primary/20 bg-admin-soft/30 p-4 text-sm text-admin-ink-soft">
        <p className="font-semibold text-admin-ink">Comment &ccedil;a marche</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            Toutes les cases coch&eacute;es = page ouverte &agrave; tout le monde
            (visiteur compris). C&apos;est le d&eacute;faut.
          </li>
          <li>
            D&eacute;coche <b>visiteur</b> pour exiger une connexion ; ne laisse
            que <b>patiente</b> + <b>abonn&eacute;</b> + <b>admin</b> pour
            r&eacute;server le contenu.
          </li>
          <li>
            Une r&egrave;gle parente couvre ses sous-pages : restreindre
            <code className="ml-1">/recettes</code> restreint aussi
            <code>/recettes/abc</code> sauf si tu poses une r&egrave;gle plus
            sp&eacute;cifique sur <code>/recettes/abc</code>.
          </li>
        </ul>
      </div>

      <PermissionsView initial={merged} />
    </div>
  );
}
