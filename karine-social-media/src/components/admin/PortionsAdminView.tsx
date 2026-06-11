'use client';

import { useEffect, useState, useCallback } from 'react';
import { Check, Plus, Loader2, Trash2, Save } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

type Tab = 'foods' | 'modifiers' | 'rule';

type Food = {
  id: number;
  name: string;
  portion_g: number;
  size_variability: 'low' | 'medium' | 'high';
  notes: string | null;
  /** true = entrée auto-créée par l'IA, en attente de validation. */
  ai_generated: boolean;
};

type Modifier = {
  id: number;
  keyword: string;
  multiplier: number;
};

export function PortionsAdminView() {
  const [tab, setTab] = useState<Tab>('foods');
  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-full bg-admin-soft/50 p-1">
        {(
          [
            ['foods', 'Aliments'],
            ['modifiers', 'Adjectifs'],
            ['rule', 'Règle'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
              tab === key
                ? 'bg-admin-primary text-white shadow'
                : 'text-admin-ink-soft hover:bg-admin-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'foods' && <FoodsTab />}
      {tab === 'modifiers' && <ModifiersTab />}
      {tab === 'rule' && <RuleTab />}
    </div>
  );
}

// ============================================================
// Onglet "Règle" : explication rédigée du calcul de portion
// ============================================================
function RuleTab() {
  return (
    <div className="space-y-5 rounded-2xl bg-admin-surface p-5 text-sm leading-relaxed text-admin-ink shadow-sm">
      <header>
        <h3 className="text-base font-bold text-admin-primary-dark">
          Comment la portion est calculée
        </h3>
        <p className="mt-1 text-xs italic text-admin-ink-soft">
          Cette règle est appliquée par le code (déterministe).
          Mistral n&apos;intervient que pour extraire l&apos;intention de
          la phrase ; le calcul lui-même utilise tes tables ci-dessus.
        </p>
      </header>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-admin-primary-dark">
          La formule
        </h4>
        <pre className="overflow-x-auto rounded-lg bg-admin-soft/30 p-3 font-mono text-xs">
          {`portion_finale_g = portion_g(aliment)
                 × multiplicateur(taille)
                 × quantité`}
        </pre>
        <ul className="ml-5 list-disc space-y-1 text-xs text-admin-ink-soft">
          <li>
            <strong>portion_g(aliment)</strong> &middot; valeur de référence
            pour 1 unité, lue dans l&apos;onglet <em>Aliments</em>.
            Ex&nbsp;: banane = 120 g.
          </li>
          <li>
            <strong>multiplicateur(taille)</strong> &middot; coefficient lu
            dans l&apos;onglet <em>Adjectifs</em> selon le mot détecté
            par Mistral. Ex&nbsp;: <em>moyenne</em> = 1.0, <em>grosse</em> = 1.4.
            Si l&apos;abonnée ne précise pas la taille, on prend 1.0.
          </li>
          <li>
            <strong>quantité</strong> &middot; nombre d&apos;unités mentionnées
            dans la phrase. &quot;une banane&quot; = 1, &quot;deux bananes&quot; = 2.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-admin-primary-dark">
          Exemples
        </h4>
        <div className="space-y-2 rounded-lg bg-admin-soft/20 p-3 text-xs">
          <p>
            <em>&quot;une banane&quot;</em> &nbsp;&rarr;&nbsp; 120 &times; 1.0
            &times; 1 = <strong>120 g</strong>
          </p>
          <p>
            <em>&quot;une grosse banane&quot;</em> &nbsp;&rarr;&nbsp; 120 &times; 1.4
            &times; 1 = <strong>168 g</strong>
          </p>
          <p>
            <em>&quot;deux petites pommes&quot;</em> &nbsp;&rarr;&nbsp; 150 &times; 0.7
            &times; 2 = <strong>210 g</strong>
          </p>
          <p>
            <em>&quot;500 g de pâtes&quot;</em> &nbsp;&rarr;&nbsp; la masse
            explicite <strong>remplace</strong> la formule &nbsp;&rarr;&nbsp;{' '}
            <strong>500 g</strong>
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-admin-primary-dark">
          Cas non couverts par la table — apprentissage automatique
        </h4>
        <p className="text-xs text-admin-ink-soft">
          Si l&apos;aliment n&apos;est pas dans la table <em>Aliments</em>
          (ex&nbsp;: &quot;p&acirc;t&eacute; en cro&ucirc;te&quot;), Mistral
          fournit une estimation, qui sert &agrave; l&apos;abonn&eacute;e
          pour la portion par d&eacute;faut.{' '}
          <strong>
            Cette estimation est aussi inscrite automatiquement dans la
            table Aliments
          </strong>{' '}
          avec un badge{' '}
          <span className="inline-block rounded-full bg-amber-200 px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wider text-amber-900">
            IA
          </span>
          .
        </p>
        <p className="text-xs text-admin-ink-soft">
          Tu retrouves ces lignes en haut de l&apos;onglet <em>Aliments</em>{' '}
          (fond ambre). Tu peux corriger la valeur si elle est aberrante
          puis cliquer sur l&apos;ic&ocirc;ne{' '}
          <Save className="inline size-3" /> pour valider — le badge IA
          dispara&icirc;t. Si tu juges la ligne inutile (mot-cl&eacute;
          mal extrait, doublon), supprime-la avec{' '}
          <Trash2 className="inline size-3" />.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-bold text-admin-primary-dark">
          Variability
        </h4>
        <ul className="ml-5 list-disc space-y-1 text-xs text-admin-ink-soft">
          <li>
            <strong>low</strong> &middot; tailles fixes (yaourt en pot,
            verre de lait) &middot; on ne propose pas de chips P/M/G dans
            l&apos;UI.
          </li>
          <li>
            <strong>medium</strong> &middot; tailles variables mais peu
            (banane, pomme) &middot; chips proposés si pas d&apos;adjectif
            d&eacute;j&agrave; mentionn&eacute;.
          </li>
          <li>
            <strong>high</strong> &middot; tailles tr&egrave;s variables
            (assiette de p&acirc;tes, salade) &middot; chips toujours
            propos&eacute;s.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ============================================================
// FOODS
// ============================================================

function FoodsTab() {
  const [items, setItems] = useState<Food[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/portions/foods');
    if (res.ok) {
      const j = await res.json();
      setItems(j.foods ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = items.filter((f) =>
    f.name.toLowerCase().includes(filter.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="size-5 animate-spin text-admin-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Rechercher un aliment…"
          className="flex-1 rounded-lg border border-admin-border bg-white px-3 py-1.5 text-sm"
        />
        <NewFoodButton onCreated={reload} />
      </div>

      <p className="text-xs text-admin-ink-soft">
        {filtered.length} aliments &middot; <strong>portion_g</strong> = masse standard
        pour 1 unit&eacute; / portion habituelle &middot; <strong>variability</strong> =
        proposer chips P/M/G &agrave; l&apos;abonn&eacute;e si pas
        d&apos;adjectif (low=non, medium=oui si pertinent, high=oui toujours)
      </p>

      {/* Sur mobile : on cache la colonne "Notes" (rarement modifiée)
          pour libérer la place et rendre les actions (Valider /
          Supprimer) visibles sans scroll horizontal. Sur sm+ : Notes
          réapparait. */}
      <div className="overflow-x-auto rounded-xl border border-admin-border">
        <table className="w-full text-sm">
          <thead className="bg-admin-soft/40 text-[0.65rem] uppercase tracking-wider text-admin-ink-soft">
            <tr>
              <th className="px-2 py-2 text-left">Nom</th>
              <th className="w-14 px-1 py-2 text-right">g</th>
              <th className="w-20 px-1 py-2 text-center sm:w-28">Variab.</th>
              <th className="hidden px-2 py-2 text-left sm:table-cell">Notes</th>
              <th className="w-20 px-1 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => (
              <FoodRow key={f.id} food={f} onChange={reload} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FoodRow({ food, onChange }: { food: Food; onChange: () => void }) {
  const [name, setName] = useState(food.name);
  const [portionG, setPortionG] = useState(String(food.portion_g));
  const [variability, setVariability] = useState(food.size_variability);
  const [notes, setNotes] = useState(food.notes ?? '');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelOpen, setConfirmDelOpen] = useState(false);

  function markDirty() {
    setDirty(true);
  }

  async function save() {
    const g = parseInt(portionG, 10);
    if (!Number.isFinite(g) || g <= 0) return;
    setBusy(true);
    await fetch(`/api/admin/portions/foods/${food.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim().toLowerCase(),
        portionG: g,
        sizeVariability: variability,
        notes: notes.trim(),
        // Tout save passe la ligne en "validée" — Karine valide en
        // sauvegardant (que la valeur change ou non).
        aiGenerated: false,
      }),
    });
    setDirty(false);
    setBusy(false);
    onChange();
  }

  async function del() {
    setBusy(true);
    await fetch(`/api/admin/portions/foods/${food.id}`, { method: 'DELETE' });
    setConfirmDelOpen(false);
    onChange();
  }

  /**
   * Validation IA explicite : passe ai_generated à false sans toucher
   * aux autres valeurs. Visible UNIQUEMENT quand la ligne est encore
   * marquée IA et que Karine n'a rien modifié (sinon le bouton Save
   * fait la validation en même temps que l'enregistrement).
   */
  async function validateAi() {
    setBusy(true);
    await fetch(`/api/admin/portions/foods/${food.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiGenerated: false }),
    });
    setBusy(false);
    onChange();
  }

  return (
    <tr
      className={`border-t border-admin-border ${
        food.ai_generated ? 'bg-amber-50/60' : ''
      }`}
    >
      <td className="relative px-2 py-1">
        {/* Badge IA en pastille coin (absolute) — n'écrase plus le
            champ Nom sur mobile étroit. Hover/click → tooltip via title. */}
        {food.ai_generated && (
          <span
            title="Estimation IA — à valider"
            aria-label="Estimation IA"
            className="pointer-events-none absolute -left-0.5 -top-0.5 z-10 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-400 px-1 text-[0.5rem] font-bold uppercase text-amber-950 shadow-sm ring-1 ring-amber-600/30"
          >
            IA
          </span>
        )}
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
          className={`w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-admin-border focus:border-admin-primary focus:bg-white ${
            food.ai_generated ? 'pl-3' : ''
          }`}
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="number"
          min={1}
          max={10000}
          value={portionG}
          onChange={(e) => {
            setPortionG(e.target.value);
            markDirty();
          }}
          className="w-16 rounded border border-transparent bg-transparent px-1 py-1 text-right hover:border-admin-border focus:border-admin-primary focus:bg-white"
        />
      </td>
      <td className="px-2 py-1 text-center">
        <select
          value={variability}
          onChange={(e) => {
            setVariability(e.target.value as Food['size_variability']);
            markDirty();
          }}
          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-admin-border focus:border-admin-primary focus:bg-white"
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </td>
      <td className="hidden px-2 py-1 sm:table-cell">
        <input
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            markDirty();
          }}
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs italic hover:border-admin-border focus:border-admin-primary focus:bg-white"
        />
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-end gap-1">
          {dirty && (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              aria-label="Enregistrer"
              title="Enregistrer les modifications (valide aussi la ligne IA)"
              className="rounded-full bg-admin-primary p-1 text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
            </button>
          )}
          {/* Bouton "Valider IA" : visible si la ligne est encore
              marquée IA ET rien n'a été modifié. Permet à Karine
              d'enlever le badge sans avoir à toucher les valeurs (= je
              valide les estimations telles quelles). */}
          {food.ai_generated && !dirty && (
            <button
              type="button"
              onClick={validateAi}
              disabled={busy}
              aria-label="Valider l'estimation IA"
              title="Valider l'estimation IA telle quelle (enlève le badge)"
              className="rounded-full bg-emerald-500 p-1 text-white disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Check className="size-3" strokeWidth={3} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDelOpen(true)}
            aria-label="Supprimer"
            title="Supprimer définitivement cette ligne"
            className="rounded-full p-1 text-admin-ink-soft hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </td>
      <ConfirmModal
        open={confirmDelOpen}
        variant="danger"
        loading={busy}
        title="Supprimer cet aliment ?"
        message={
          <>
            « <strong>{food.name}</strong> » sera retiré de la grille.
            Au prochain parse, l&apos;app retombera sur l&apos;estimation
            IA si l&apos;aliment est cité.
          </>
        }
        confirmLabel="Supprimer"
        onConfirm={del}
        onCancel={() => setConfirmDelOpen(false)}
      />
    </tr>
  );
}

function NewFoodButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [portionG, setPortionG] = useState('150');
  const [busy, setBusy] = useState(false);

  async function create() {
    const g = parseInt(portionG, 10);
    if (!name.trim() || !Number.isFinite(g) || g <= 0) return;
    setBusy(true);
    const res = await fetch('/api/admin/portions/foods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim().toLowerCase(),
        portionG: g,
        sizeVariability: 'medium',
      }),
    });
    if (res.ok) {
      setName('');
      setPortionG('150');
      setOpen(false);
      onCreated();
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white"
      >
        <Plus className="size-3.5" />
        Ajouter
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="nom"
        autoFocus
        className="w-28 rounded border border-admin-border bg-white px-2 py-1 text-sm"
      />
      <input
        type="number"
        value={portionG}
        onChange={(e) => setPortionG(e.target.value)}
        className="w-16 rounded border border-admin-border bg-white px-1 py-1 text-right text-sm"
      />
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="rounded-full bg-admin-primary p-1.5 text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 text-xs text-admin-ink-soft"
      >
        Annuler
      </button>
    </div>
  );
}

// ============================================================
// MODIFIERS
// ============================================================

function ModifiersTab() {
  const [items, setItems] = useState<Modifier[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/portions/modifiers');
    if (res.ok) {
      const j = await res.json();
      setItems(j.modifiers ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="size-5 animate-spin text-admin-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <NewModifierButton onCreated={reload} />
      <p className="text-xs text-admin-ink-soft">
        Multiplicateur appliqu&eacute; quand Mistral d&eacute;tecte cet adjectif
        dans la phrase. Ex : &quot;une <b>grosse</b> assiette de frites&quot;
        &rarr; 250g &times; 1.4 = 350g.
      </p>
      <div className="overflow-x-auto rounded-xl border border-admin-border">
        <table className="w-full min-w-[24rem] text-sm">
          <thead className="bg-admin-soft/40 text-[0.65rem] uppercase tracking-wider text-admin-ink-soft">
            <tr>
              <th className="px-2 py-2 text-left">Mot-cl&eacute;</th>
              <th className="w-24 px-2 py-2 text-right">Multiplicateur</th>
              <th className="w-20 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <ModifierRow key={m.id} modifier={m} onChange={reload} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ModifierRow({
  modifier,
  onChange,
}: {
  modifier: Modifier;
  onChange: () => void;
}) {
  const [keyword, setKeyword] = useState(modifier.keyword);
  const [multiplier, setMultiplier] = useState(String(modifier.multiplier));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  async function save() {
    const m = parseFloat(multiplier);
    if (!Number.isFinite(m) || m <= 0) return;
    setBusy(true);
    await fetch(`/api/admin/portions/modifiers/${modifier.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: keyword.trim().toLowerCase(),
        multiplier: m,
      }),
    });
    setDirty(false);
    setBusy(false);
    onChange();
  }

  async function del() {
    setConfirmDel(false);
    await fetch(`/api/admin/portions/modifiers/${modifier.id}`, {
      method: 'DELETE',
    });
    onChange();
  }

  return (
    <tr className="border-t border-admin-border">
      <td className="px-2 py-1">
        <input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setDirty(true);
          }}
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-admin-border focus:border-admin-primary focus:bg-white"
        />
      </td>
      <td className="px-2 py-1">
        <input
          type="number"
          step={0.1}
          min={0.1}
          max={10}
          value={multiplier}
          onChange={(e) => {
            setMultiplier(e.target.value);
            setDirty(true);
          }}
          className="w-20 rounded border border-transparent bg-transparent px-1 py-1 text-right hover:border-admin-border focus:border-admin-primary focus:bg-white"
        />
      </td>
      <td className="px-2 py-1">
        <div className="flex items-center justify-end gap-1">
          {dirty && (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded-full bg-admin-primary p-1 text-white disabled:opacity-50"
              aria-label="Enregistrer"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDel(true)}
            aria-label="Supprimer"
            className="rounded-full p-1 text-admin-ink-soft hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </td>
      <ConfirmModal
        open={confirmDel}
        title="Supprimer ce modificateur ?"
        message={`Le modificateur « ${modifier.keyword} » sera supprimé définitivement.`}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        onConfirm={del}
        onCancel={() => setConfirmDel(false)}
      />
    </tr>
  );
}

function NewModifierButton({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [multiplier, setMultiplier] = useState('1.0');
  const [busy, setBusy] = useState(false);

  async function create() {
    const m = parseFloat(multiplier);
    if (!keyword.trim() || !Number.isFinite(m) || m <= 0) return;
    setBusy(true);
    const res = await fetch('/api/admin/portions/modifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: keyword.trim().toLowerCase(),
        multiplier: m,
      }),
    });
    if (res.ok) {
      setKeyword('');
      setMultiplier('1.0');
      setOpen(false);
      onCreated();
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white"
      >
        <Plus className="size-3.5" />
        Ajouter
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="petit, gros, énorme…"
        autoFocus
        className="w-40 rounded border border-admin-border bg-white px-2 py-1 text-sm"
      />
      <input
        type="number"
        step={0.1}
        value={multiplier}
        onChange={(e) => setMultiplier(e.target.value)}
        className="w-20 rounded border border-admin-border bg-white px-1 py-1 text-right text-sm"
      />
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="rounded-full bg-admin-primary p-1.5 text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-2 text-xs text-admin-ink-soft"
      >
        Annuler
      </button>
    </div>
  );
}
