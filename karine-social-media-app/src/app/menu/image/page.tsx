"use client";
import { useRef, useState } from "react";

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const EXEMPLES = [
  "Épinards, tomates cerises 🍅, saumon au four et burrata",
  "Cuisse de poulet 🍗 rôtie aux herbes, carottes 🥕 + panais rôtis au four",
  "Omelette aux champignons et salade verte ou endives et PDT 🥔 sautées",
  "Lentilles carottes 🥕 saucisse",
  "Pâtes carbonara et crudités ou bol de soupe",
  "Dos de cabillaud, tian de légumes provençaux",
  "Poulet rôti, haricots verts et riz basmati",
];

export default function MenuImagePage() {
  const [repas, setRepas] = useState<string[]>(Array(7).fill(""));
  const [semaine, setSemaine] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [messageBasGauche, setMessageBasGauche] = useState("Je vous partagerai quelques recettes");
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateRepas = (i: number, val: string) => {
    const copy = [...repas];
    copy[i] = val;
    setRepas(copy);
  };

  const remplirExemples = () => setRepas(EXEMPLES);

  const onBgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBgImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const telecharger = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#F5EDE0",
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `menu-semaine-karine.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally {
      setDownloading(false);
    }
  };

  const semaineCourante = () => {
    const now = new Date();
    const lundi = new Date(now);
    lundi.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const dimanche = new Date(lundi);
    dimanche.setDate(lundi.getDate() + 6);
    return `${lundi.getDate()} – ${dimanche.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
  };

  const labelSemaine = semaine || semaineCourante();
  const repasRemplis = repas.some((r) => r.trim());

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: "var(--green-dark)" }}>
        🖼️ Image du menu de la semaine
      </h1>
      <p className="text-sm mb-6" style={{ color: "#7A9A8A" }}>
        Saisis les dîners · l&apos;image Instagram est générée automatiquement
      </p>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Formulaire */}
        <div className="space-y-4">

          {/* Image de fond */}
          <div className="rounded-2xl border p-4" style={{ background: "white", borderColor: "#E0E8E4" }}>
            <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
              📷 Image de fond
            </label>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 cursor-pointer transition hover:opacity-80"
              style={{ borderColor: "#C8DDD6" }}
            >
              {bgImage ? (
                <>
                  <img src={bgImage} alt="fond" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8 }} />
                  <span className="text-sm" style={{ color: "var(--green-dark)" }}>Image chargée — cliquer pour changer</span>
                </>
              ) : (
                <>
                  <span className="text-2xl">🖼️</span>
                  <span className="text-sm" style={{ color: "#7A9A8A" }}>Charger la photo de fond (assiette, fourchette…)</span>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onBgChange} className="hidden" />
            {!bgImage && (
              <p className="text-xs mt-2" style={{ color: "#7A9A8A" }}>
                Sans image de fond, un dégradé beige sera utilisé.
              </p>
            )}
          </div>

          {/* Repas */}
          <div className="rounded-2xl border p-5" style={{ background: "white", borderColor: "#E0E8E4" }}>
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-medium" style={{ color: "var(--green-dark)" }}>
                Les dîners de la semaine
              </label>
              <button
                onClick={remplirExemples}
                className="text-xs px-3 py-1.5 rounded-lg border transition hover:opacity-80"
                style={{ borderColor: "#C8DDD6", color: "#7A9A8A" }}
              >
                Exemples
              </button>
            </div>
            <div className="grid gap-3">
              {JOURS.map((jour, i) => (
                <div key={jour} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-20 shrink-0" style={{ color: "#B03A2E" }}>
                    {jour.toUpperCase()}
                  </span>
                  <input
                    type="text"
                    value={repas[i]}
                    onChange={(e) => updateRepas(i, e.target.value)}
                    placeholder={`Dîner du ${jour.toLowerCase()}...`}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
                    style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t" style={{ borderColor: "#E0E8E4" }}>
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
                Dates de la semaine <span style={{ color: "#7A9A8A" }}>(optionnel)</span>
              </label>
              <input
                type="text"
                value={semaine}
                onChange={(e) => setSemaine(e.target.value)}
                placeholder={semaineCourante()}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
                style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium mb-2" style={{ color: "var(--green-dark)" }}>
                Message bas gauche <span style={{ color: "#7A9A8A" }}>(optionnel)</span>
              </label>
              <input
                type="text"
                value={messageBasGauche}
                onChange={(e) => setMessageBasGauche(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-1"
                style={{ borderColor: "#C8DDD6", background: "var(--green-light)" }}
              />
            </div>
          </div>

          <button
            onClick={telecharger}
            disabled={downloading || !repasRemplis}
            className="w-full py-3 rounded-xl font-medium text-white text-sm transition hover:opacity-90 disabled:opacity-40"
            style={{ background: "var(--green)" }}
          >
            {downloading ? "⏳ Génération de l'image..." : "⬇️ Télécharger l'image PNG"}
          </button>
        </div>

        {/* Aperçu */}
        <div>
          <div className="text-xs font-medium mb-2" style={{ color: "#7A9A8A" }}>
            APERÇU (format Instagram)
          </div>
          <div
            ref={cardRef}
            style={{
              width: "100%",
              aspectRatio: "1 / 1",
              position: "relative",
              overflow: "hidden",
              fontFamily: "system-ui, sans-serif",
              boxSizing: "border-box",
              background: bgImage ? `url(${bgImage}) center/cover no-repeat` : "radial-gradient(ellipse at 70% 30%, #EDE0CE 0%, #F5EDE0 60%, #EAE0D5 100%)",
            }}
          >
            {/* Voile léger sur le fond pour lisibilité */}
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(255,255,255,0.08)",
            }} />

            {/* MENU SEMAINE — haut droite */}
            <div style={{
              position: "absolute",
              top: "4%",
              right: "4%",
              textAlign: "right",
              lineHeight: 0.95,
              zIndex: 2,
            }}>
              <div style={{
                fontSize: "clamp(28px, 5.5vw, 52px)",
                fontWeight: 900,
                color: "#111111",
                letterSpacing: "-1.5px",
                textTransform: "uppercase",
                fontFamily: "system-ui, sans-serif",
              }}>
                MENU
              </div>
              <div style={{
                fontSize: "clamp(28px, 5.5vw, 52px)",
                fontWeight: 900,
                color: "#111111",
                letterSpacing: "-1.5px",
                textTransform: "uppercase",
                fontFamily: "system-ui, sans-serif",
              }}>
                SEMAINE
              </div>
              <div style={{
                fontSize: "clamp(9px, 1.4vw, 12px)",
                color: "#555",
                marginTop: "4px",
                letterSpacing: "0.05em",
              }}>
                {labelSemaine}
              </div>
            </div>

            {/* Carte blanche centrale */}
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "white",
              borderRadius: "3px",
              paddingTop: "20px",
              paddingBottom: "14px",
              paddingLeft: "18px",
              paddingRight: "18px",
              width: "50%",
              textAlign: "center",
              boxShadow: "0 6px 30px rgba(0,0,0,0.15)",
              zIndex: 2,
            }}>
              {JOURS.map((jour, i) =>
                repas[i].trim() ? (
                  <div key={jour} style={{ marginBottom: "9px" }}>
                    <div style={{
                      fontSize: "clamp(9px, 1.6vw, 13px)",
                      fontWeight: 800,
                      color: "#B03A2E",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      marginBottom: "2px",
                      fontFamily: "system-ui, sans-serif",
                    }}>
                      {jour}
                    </div>
                    <div style={{
                      fontSize: "clamp(7px, 1.2vw, 10.5px)",
                      color: "#1A1A1A",
                      textTransform: "uppercase",
                      lineHeight: 1.4,
                      letterSpacing: "0.02em",
                      fontFamily: "system-ui, sans-serif",
                    }}>
                      {repas[i]}
                    </div>
                  </div>
                ) : null
              )}

              {/* Bon appétit */}
              <div style={{
                marginTop: "10px",
                paddingTop: "8px",
                borderTop: "1px solid #eee",
                fontFamily: "'Dancing Script', Georgia, cursive",
                fontSize: "clamp(15px, 2.8vw, 24px)",
                color: "#B03A2E",
                fontWeight: 700,
              }}>
                Bon appétit
              </div>
            </div>

            {/* Encart bas gauche */}
            {messageBasGauche && (
              <div style={{
                position: "absolute",
                bottom: "4%",
                left: "4%",
                zIndex: 2,
                background: "white",
                border: "2.5px solid #B03A2E",
                borderRadius: "4px",
                padding: "8px 12px",
                maxWidth: "28%",
                boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
              }}>
                <div style={{
                  fontFamily: "'Dancing Script', Georgia, cursive",
                  color: "#B03A2E",
                  fontSize: "clamp(9px, 1.5vw, 13px)",
                  fontWeight: 700,
                  lineHeight: 1.3,
                  textAlign: "center",
                }}>
                  {messageBasGauche}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
