'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { RecipeIngredient } from '@/data/recipes';

/**
 * Liste structurée d'ingrédients style "à cocher" (esthétique liste de
 * courses) + 100% éditable côté admin.
 *
 *   - Bloc par catégorie avec header bandeau
 *   - Chaque ligne : case carrée déco + qty + unité + label + corbeille
 *   - Bouton "+ Ajouter dans {catégorie}" par bloc
 *   - Bouton "+ Nouvelle catégorie" en bas avec input inline (PAS de
 *     window.prompt — respecte la règle UX du projet)
 *
 * Utilisée dans RecipeFormUnified (création) ET RecipeSheetsEditor
 * (édition d'une sheet existante).
 */
export function IngredientsChecklist({
  ingredients,
  onChange,
}: {
  ingredients: RecipeIngredient[];
  onChange: (next: RecipeIngredient[]) => void;
}) {
  const [newCategoryInput, setNewCategoryInput] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of ingredients) {
      if (!seen.has(it.category)) {
        seen.add(it.category);
        out.push(it.category);
      }
    }
    return out;
  }, [ingredients]);

  function updateAt(idx: number, patch: Partial<RecipeIngredient>) {
    onChange(ingredients.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeAt(idx: number) {
    onChange(ingredients.filter((_, i) => i !== idx));
  }
  function addIn(category: string) {
    onChange([
      ...ingredients,
      { category, label: '', quantity: null, unit: null, note: null },
    ]);
  }
  function commitNewCategory() {
    const name = (newCategoryInput ?? '').trim();
    if (name) {
      onChange([
        ...ingredients,
        { category: name, label: '', quantity: null, unit: null, note: null },
      ]);
    }
    setNewCategoryInput(null);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wider text-admin-primary-dark">
        Ingrédients ({ingredients.length})
      </p>

      {categories.length === 0 && newCategoryInput === null && (
        <p className="rounded-lg bg-admin-soft/30 px-3 py-2 text-xs italic text-admin-ink-soft">
          Aucun ingrédient. Crée une catégorie ci-dessous pour commencer.
        </p>
      )}

      {categories.map((cat) => (
        <div
          key={cat}
          className="overflow-hidden rounded-xl border border-admin-border bg-white"
        >
          <header className="border-b border-admin-border bg-admin-soft/40 px-3 py-1.5">
            <p className="text-[0.65rem] font-bold uppercase tracking-wider text-admin-primary-dark">
              {cat}
            </p>
          </header>
          <ul className="divide-y divide-admin-border">
            {ingredients
              .map((ing, absIdx) => ({ ing, absIdx }))
              .filter(({ ing }) => ing.category === cat)
              .map(({ ing, absIdx }) => (
                <Row
                  key={absIdx}
                  ing={ing}
                  onUpdate={(p) => updateAt(absIdx, p)}
                  onRemove={() => removeAt(absIdx)}
                />
              ))}
          </ul>
          <button
            type="button"
            onClick={() => addIn(cat)}
            className="flex w-full items-center gap-1.5 border-t border-admin-border bg-admin-surface/40 px-3 py-1.5 text-xs font-semibold text-admin-ink-soft transition hover:bg-admin-soft/30"
          >
            <Plus className="h-3 w-3" /> Ajouter dans {cat}
          </button>
        </div>
      ))}

      {newCategoryInput === null ? (
        <button
          type="button"
          onClick={() => setNewCategoryInput('')}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-admin-border bg-admin-surface/60 py-2 text-xs font-semibold text-admin-ink-soft transition hover:bg-admin-soft/30"
        >
          <Plus className="h-3 w-3" /> Nouvelle catégorie
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-admin-border bg-white p-2">
          <input
            autoFocus
            type="text"
            value={newCategoryInput}
            onChange={(e) => setNewCategoryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitNewCategory();
              } else if (e.key === 'Escape') {
                setNewCategoryInput(null);
              }
            }}
            placeholder="ex: Épicerie, Fruits & Légumes…"
            className="input h-8 flex-1 text-sm"
          />
          <button
            type="button"
            onClick={commitNewCategory}
            className="rounded-full bg-admin-primary px-3 py-1 text-xs font-bold text-white"
          >
            Ajouter
          </button>
          <button
            type="button"
            onClick={() => setNewCategoryInput(null)}
            className="rounded-full border border-admin-border bg-white px-3 py-1 text-xs font-semibold text-admin-ink-soft"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}

function Row({
  ing,
  onUpdate,
  onRemove,
}: {
  ing: RecipeIngredient;
  onUpdate: (patch: Partial<RecipeIngredient>) => void;
  onRemove: () => void;
}) {
  // State LOCAL pour chaque input : la valeur en cours de saisie n'est
  // PAS propagee au parent a chaque keystroke (sinon onChange → PATCH
  // serveur → reponse qui ecrase la saisie en cours = impossibilite
  // de taper "12" — la 1ere frappe "1" est sauvee, la reponse
  // serveur ecrase le state avec "1" avant qu'on tape "2").
  // Le commit se fait sur onBlur (perte de focus) ou Enter.
  const [qtyText, setQtyText] = useState(ing.quantity?.toString() ?? '');
  const [unitText, setUnitText] = useState(ing.unit ?? '');
  const [labelText, setLabelText] = useState(ing.label);
  const [noteText, setNoteText] = useState(ing.note ?? '');

  // Re-sync si l'ingredient externe change (ex. apres save serveur).
  useEffect(() => {
    setQtyText(ing.quantity?.toString() ?? '');
  }, [ing.quantity]);
  useEffect(() => setUnitText(ing.unit ?? ''), [ing.unit]);
  useEffect(() => setLabelText(ing.label), [ing.label]);
  useEffect(() => setNoteText(ing.note ?? ''), [ing.note]);

  function commitQty() {
    const next = qtyText.trim() === '' ? null : Math.max(0, Number(qtyText) || 0);
    if (next !== ing.quantity) onUpdate({ quantity: next });
  }
  function commitUnit() {
    const next = unitText.trim() === '' ? null : unitText;
    if (next !== ing.unit) onUpdate({ unit: next });
  }
  function commitLabel() {
    if (labelText !== ing.label) onUpdate({ label: labelText });
  }
  function commitNote() {
    const next = noteText.trim() === '' ? null : noteText;
    if (next !== ing.note) onUpdate({ note: next });
  }

  return (
    <li className="grid grid-cols-[1.5rem_3rem_3rem_1fr_auto] items-center gap-1.5 px-2.5 py-1.5 sm:grid-cols-[1.5rem_4rem_4rem_1fr_2fr_auto]">
      <span
        aria-hidden
        className="grid h-4 w-4 shrink-0 place-items-center rounded border-2 border-coral-soft bg-white"
      />
      <input
        type="number"
        step="0.5"
        min="0"
        value={qtyText}
        onChange={(e) => setQtyText(e.target.value)}
        onBlur={commitQty}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        className="input h-8 px-1.5 text-center text-sm"
      />
      <input
        type="text"
        value={unitText}
        onChange={(e) => setUnitText(e.target.value)}
        onBlur={commitUnit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="g/cl"
        className="input h-8 px-1.5 text-center text-sm"
      />
      <input
        type="text"
        value={labelText}
        onChange={(e) => setLabelText(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="ingrédient"
        className="input h-8 px-2 text-sm"
      />
      <input
        type="text"
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        onBlur={commitNote}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="note (optionnel)"
        className="input hidden h-8 px-2 text-xs italic text-admin-ink-soft sm:block"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Supprimer cette ligne"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-admin-ink-soft transition hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
