"use client";
import { useState } from "react";
import PromptBox from "@/components/PromptBox";
import { buildRecettePrompt } from "@/lib/buildPrompt";

export default function RecettePage() {
  const [description, setDescription] = useState("");
  const [nom, setNom] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [prompt, setPrompt] = useState("");

  const generer = () => {
    if (!description.trim()) return;
    setPrompt(buildRecettePrompt(description, nom, ingredients));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--green-dark)" }}>
        🍽️ Post recette du jour
      </h1>
      <p className="text-sm mb-6" style={{ color: "#7A9A8A" }}>
        Décris le plat · le prompt Instagram est généré automatiquement
      </p>

      {/* Formulaire */}
      <div className="rounded-2xl border p-6 mb-6" style={{ background: "white", borderColor: "#E0E8E4" }}>
        <div className="grid gap-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
              Description du plat <span style={{ color: "#c0392b" }}>*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex : gratin de courgettes et chèvre au four, légumes de saison gratinés avec du fromage de chèvre frais..."
              rows={3}
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 resize-none"
              style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
                Nom du plat <span style={{ color: "#7A9A8A" }}>(optionnel)</span>
              </label>
              <input
                type="text"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                placeholder="Ex : Gratin courgettes-chèvre"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2"
                style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
                Ingrédients clés <span style={{ color: "#7A9A8A" }}>(optionnel)</span>
              </label>
              <input
                type="text"
                value={ingredients}
                onChange={(e) => setIngredients(e.target.value)}
                placeholder="Ex : courgettes, fromage de chèvre, herbes"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2"
                style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
              />
            </div>
          </div>
        </div>
        <button
          onClick={generer}
          disabled={!description.trim()}
          className="mt-4 px-6 py-3 rounded-xl font-medium text-white text-sm transition hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--gold)" }}
        >
          ✨ Générer le prompt
        </button>
      </div>

      {/* Prompt généré */}
      {prompt && <PromptBox prompt={prompt} />}
    </div>
  );
}
