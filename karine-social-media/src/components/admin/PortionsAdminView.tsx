'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Loader2, Trash2, Save } from 'lucide-react';

type Tab = 'foods' | 'modifiers';

type Food = {
  id: number;
  name: string;
  portion_g: number;
  size_variability: 'low' | 'medium' | 'high';
  notes: string | null;
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

      <div className="overflow-hidden rounded-xl border border-admin-border">
        <table className="w-full text-sm">
          <thead className="bg-admin-soft/40 text-[0.65rem] uppercase tracking-wider text-admin-ink-soft">
            <tr>
              <th className="px-2 py-2 text-left">Nom</th>
              <th className="w-20 px-2 py-2 text-right">g</th>
              <th className="w-28 px-2 py-2 text-center">Variability</th>
              <th className="px-2 py-2 text-left">Notes</th>
              <th className="w-20 px-2 py-2"></th>
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
      }),
    });
    setDirty(false);
    setBusy(false);
    onChange();
  }

  async function del() {
    if (!confirm(`Supprimer "${food.name}" ?`)) return;
    setBusy(true);
    await fetch(`/api/admin/portions/foods/${food.id}`, { method: 'DELETE' });
    onChange();
  }

  return (
    <tr className="border-t border-admin-border">
      <td className="px-2 py-1">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-admin-border focus:border-admin-primary focus:bg-white"
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
      <td className="px-2 py-1">
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
              className="rounded-full bg-admin-primary p-1 text-white disabled:opacity-50"
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
            onClick={del}
            aria-label="Supprimer"
            className="rounded-full p-1 text-admin-ink-soft hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </td>
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
      <div className="overflow-hidden rounded-xl border border-admin-border">
        <table className="w-full text-sm">
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
    if (!confirm(`Supprimer "${modifier.keyword}" ?`)) return;
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
            onClick={del}
            aria-label="Supprimer"
            className="rounded-full p-1 text-admin-ink-soft hover:bg-rose-50 hover:text-rose-600"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </td>
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
