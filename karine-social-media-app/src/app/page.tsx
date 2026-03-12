import Link from "next/link";

const jours = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

export default function Home() {
  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long"
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--green-dark)" }}>
          Bonjour 👋
        </h1>
        <p className="text-sm" style={{ color: "#7A9A8A" }}>
          {today.charAt(0).toUpperCase() + today.slice(1)}
        </p>
      </div>

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/menu" className="rounded-2xl p-6 border transition hover:shadow-lg block" style={{ background: "var(--green-light)", borderColor: "#B8D8CC" }}>
          <div className="text-3xl mb-3">📅</div>
          <div className="font-semibold text-lg mb-1" style={{ color: "var(--green-dark)" }}>Menu de la semaine</div>
          <p className="text-sm mb-4" style={{ color: "#4A6358" }}>
            Génère 7 dîners équilibrés, de saison, avec liste d&apos;ingrédients complète.
          </p>
          <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: "var(--green)", color: "white" }}>
            Chaque dimanche
          </span>
        </Link>

        <Link href="/recette" className="rounded-2xl p-6 border transition hover:shadow-lg block" style={{ background: "#FFF8EE", borderColor: "#F0DFB8" }}>
          <div className="text-3xl mb-3">🍽️</div>
          <div className="font-semibold text-lg mb-1" style={{ color: "var(--green-dark)" }}>Post recette du jour</div>
          <p className="text-sm mb-4" style={{ color: "#4A6358" }}>
            Décris le plat du jour — la légende Instagram est générée automatiquement.
          </p>
          <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: "var(--gold)", color: "white" }}>
            Chaque jour
          </span>
        </Link>

        <Link href="/conseil" className="rounded-2xl p-6 border transition hover:shadow-lg block" style={{ background: "#F0F4FF", borderColor: "#C8D4F0" }}>
          <div className="text-3xl mb-3">💡</div>
          <div className="font-semibold text-lg mb-1" style={{ color: "var(--green-dark)" }}>Conseil diététique</div>
          <p className="text-sm mb-4" style={{ color: "#4A6358" }}>
            Génère un post conseil nutritionnel pédagogique et actionnable.
          </p>
          <span className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: "#5B6EA8", color: "white" }}>
            Lun · Mer · Ven
          </span>
        </Link>
      </div>

      {/* Image du menu */}
      <div className="mt-4">
        <Link href="/menu/image" className="flex items-center gap-4 rounded-2xl p-5 border transition hover:shadow-lg block" style={{ background: "linear-gradient(135deg, #1C3A2E 0%, #2E7D5E 100%)", borderColor: "#1C3A2E", textDecoration: "none" }}>
          <div className="text-3xl">🖼️</div>
          <div className="flex-1">
            <div className="font-semibold text-base mb-0.5" style={{ color: "white" }}>Image Instagram du menu</div>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.65)" }}>
              Génère une image carrée prête à poster · format Instagram
            </p>
          </div>
          <span style={{ color: "#C9A84C", fontSize: "20px" }}>→</span>
        </Link>
      </div>

      {/* Planning */}
      <div className="mt-8 rounded-2xl border p-6" style={{ background: "white", borderColor: "#E0E8E4" }}>
        <h2 className="font-semibold text-base mb-4" style={{ color: "var(--green-dark)" }}>
          Planning de la semaine
        </h2>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {jours.map((jour, i) => (
            <div key={jour} className="flex flex-col gap-1">
              <div className="font-medium py-1" style={{ color: "#4A6358" }}>{jour.slice(0, 3)}</div>
              <div className="py-1 rounded" style={{ background: "var(--green-light)", color: "var(--green)" }}>🍽️</div>
              {(i === 0 || i === 2 || i === 4) && (
                <div className="py-1 rounded" style={{ background: "#F0F4FF", color: "#5B6EA8" }}>💡</div>
              )}
              {i === 6 && (
                <div className="py-1 rounded" style={{ background: "var(--beige)", color: "#8B6914" }}>📅</div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-3 text-xs" style={{ color: "#7A9A8A" }}>
          <span>🍽️ Recette</span>
          <span>💡 Conseil</span>
          <span>📅 Menu semaine</span>
        </div>
      </div>
    </div>
  );
}
