"""ComfyUI workflow GUI → API converter.

ComfyUI a 2 formats :
- GUI : ce que ComfyUI sauvegarde par defaut. Contient nodes (avec position,
  widgets_values comme array sans noms, inputs/outputs avec links), links
  (array de tuples), groups, etc.
- API : ce que /api/prompt accepte. Dict plat {node_id: {class_type, inputs}}
  ou inputs est un dict {input_name: value | [src_node_id, src_slot]}.

La GUI->API conversion necessite de connaitre la SIGNATURE de chaque node
(quels params sont des widgets vs des inputs connectables, dans quel ordre).
Cette info est servie par /object_info de ComfyUI.

Usage:
  python scripts/comfyui_gui_to_api.py <input_gui.json> <output_api.json>
  # Suppose ComfyUI tourne sur http://127.0.0.1:8188

Subtilites traitees :
  - mode=4 (bypass) : node skip + link rebranche au input correspondant par type
  - Reroute : suit la chaine pour resoudre la vraie source
  - Primitive nodes (PrimitiveNode, PrimitiveFloat, INTConstant) : laisses tel
    quels (ComfyUI les accepte en API)
  - Notes : skipees (pas de class_type executable)
  - Widgets multi-value (seed + control_after_generate) : detectes via
    object_info quand le widget INT a "control_after_generate"
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

COMFY_URL = 'http://127.0.0.1:8188'

# Nodes purement utilitaires GUI qui n'existent pas en API
SKIP_TYPES = {'Note', 'Reroute', 'MarkdownNote', 'PrimitiveNode'}


def fetch_object_info(url: str = COMFY_URL) -> dict:
    """Recupere /object_info de ComfyUI (tous les schemas de nodes)."""
    print(f'[converter] Fetching {url}/object_info ...', file=sys.stderr)
    try:
        req = urllib.request.Request(f'{url}/object_info')
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.load(r)
        print(f'[converter] Got {len(data)} node schemas', file=sys.stderr)
        return data
    except urllib.error.URLError as e:
        print(
            f'[converter] ERREUR : ComfyUI injoignable a {url}.\n'
            f'  Lance ComfyUI puis re-essaie.\n  Detail : {e}',
            file=sys.stderr,
        )
        sys.exit(1)


def get_input_order(class_type: str, object_info: dict) -> list[tuple[str, dict]]:
    """Retourne la liste ordonnee [(name, spec_dict), ...] des inputs d'un node.

    spec_dict est le 2e element du tuple ComfyUI : {default, min, max,
    control_after_generate, ...}. Vide si non specifie.
    """
    info = object_info.get(class_type)
    if not info:
        return []
    inp = info.get('input', {})
    ordered = []
    for section in ('required', 'optional'):
        for name, spec in inp.get(section, {}).items():
            # spec est typiquement [type_str_or_list, options_dict] ou [type]
            options = spec[1] if isinstance(spec, list) and len(spec) > 1 else {}
            if not isinstance(options, dict):
                options = {}
            ordered.append((name, options))
    return ordered


def widgets_count_for_input(input_type, options: dict) -> int:
    """Combien de slots widgets_values ce widget consomme.

    Cas multi-slot connus :
    - INT/FLOAT avec control_after_generate=True : 2 slots (valeur + control)
      MAIS uniquement si le node n'a PAS l'input nomme separement
    """
    # control_after_generate ajoute un widget supplementaire dans l'ordre
    # NOTE : ComfyUI insere ce widget AUTOMATIQUEMENT pour les seeds.
    # On se fie a object_info qui contient parfois control_after_generate
    # dans les options.
    if options.get('control_after_generate'):
        return 2
    return 1


def is_widget_input(input_type, options: dict) -> bool:
    """True si cet input est un widget (valeur dans widgets_values), False
    si c'est un input connectable (recoit un link).

    Convention ComfyUI :
    - type str primitive (INT, FLOAT, STRING, BOOLEAN) -> widget
    - type list (combo dropdown) -> widget
    - type str non-primitive (MODEL, CLIP, VAE, IMAGE, LATENT, ...) -> input connectable
    Mais en pratique, tous peuvent etre BOTH si le node accepte le force_input.
    L'info reelle vient du fait que le node GUI a un input avec le meme nom :
    -> si oui, c'est connecte, pas un widget
    -> sinon, c'est un widget
    """
    PRIMITIVE_TYPES = {'INT', 'FLOAT', 'STRING', 'BOOLEAN'}
    if isinstance(input_type, list):
        return True  # combo dropdown
    if isinstance(input_type, str):
        if input_type in PRIMITIVE_TYPES:
            return True
        return False
    return False


def get_input_type(class_type: str, input_name: str, object_info: dict):
    """Retourne le type brut (str ou list) d'un input."""
    info = object_info.get(class_type, {})
    inp = info.get('input', {})
    for section in ('required', 'optional'):
        if input_name in inp.get(section, {}):
            spec = inp[section][input_name]
            return spec[0] if isinstance(spec, list) and spec else spec
    return None


def resolve_link_source(
    link_id: int,
    nodes: dict,
    links: dict,
    visited: set | None = None,
) -> list | None:
    """Suit un link en sautant les Reroute et les nodes bypassed (mode=4).

    Pour bypass : trouve l'input correspondant a l'output (par type) et suit
    son link a la place.

    Retourne [src_node_id_str, src_slot] ou None.
    """
    visited = visited or set()
    if link_id in visited:
        return None
    visited.add(link_id)
    link = links.get(link_id)
    if not link:
        return None
    # link format : [link_id, from_node, from_slot, to_node, to_slot, type]
    from_node_id, from_slot = link[1], link[2]
    from_node = nodes.get(from_node_id)
    if not from_node:
        return None
    mode = from_node.get('mode', 0)
    ntype = from_node.get('type')

    # Reroute : pass-through (1 input, 1 output)
    if ntype == 'Reroute':
        for inp in from_node.get('inputs', []):
            if inp.get('link') is not None:
                return resolve_link_source(inp['link'], nodes, links, visited)
        return None

    # Bypass : trouver l'input correspondant a l'output par type, et suivre
    if mode == 4:
        outputs = from_node.get('outputs', [])
        if from_slot >= len(outputs):
            return None
        out_type = outputs[from_slot].get('type')
        # Cherche un input de meme type qui a un link
        for inp in from_node.get('inputs', []):
            if inp.get('type') == out_type and inp.get('link') is not None:
                return resolve_link_source(inp['link'], nodes, links, visited)
        # Pas de match direct -> tenter le 1er input avec link (heuristique
        # pour les nodes pass-through type "ModelMergeXxx")
        for inp in from_node.get('inputs', []):
            if inp.get('link') is not None:
                return resolve_link_source(inp['link'], nodes, links, visited)
        return None

    return [str(from_node_id), from_slot]


def convert(gui: dict, object_info: dict) -> dict:
    nodes = {n['id']: n for n in gui.get('nodes', [])}
    links = {l[0]: l for l in gui.get('links', [])}
    api: dict = {}
    skipped_unknown: set[str] = set()

    for nid, node in nodes.items():
        if node.get('mode', 0) == 4:
            continue  # bypassed
        ntype = node.get('type', '')
        if ntype in SKIP_TYPES:
            continue

        # Verifie qu'on connait le node
        if ntype not in object_info:
            # Custom nodes inconnus -> on les skip avec warning
            skipped_unknown.add(ntype)
            continue

        ordered_inputs = get_input_order(ntype, object_info)
        connected = {i['name']: i for i in node.get('inputs', []) if i.get('link') is not None}

        api_inputs: dict = {}
        widgets_values = node.get('widgets_values') or []
        wi = 0  # index dans widgets_values

        for name, opts in ordered_inputs:
            input_type = get_input_type(ntype, name, object_info)

            if name in connected:
                src = resolve_link_source(connected[name]['link'], nodes, links)
                if src is not None:
                    api_inputs[name] = src
                # Si src est None (chaine entierement bypassed), on omet
                # l'input -> ComfyUI utilisera le defaut si c'est optional
                continue

            # Pas connecte -> widget si type est primitif ou combo
            if is_widget_input(input_type, opts):
                if wi < len(widgets_values):
                    api_inputs[name] = widgets_values[wi]
                    wi += 1
                    # Skip extra slot pour control_after_generate
                    extra = widgets_count_for_input(input_type, opts) - 1
                    wi += extra
            # Sinon : input connectable non connecte -> on omet (comme ComfyUI)

        api[str(nid)] = {
            '_meta': {'title': node.get('title') or ntype},
            'class_type': ntype,
            'inputs': api_inputs,
        }

    if skipped_unknown:
        print(
            f'[converter] WARN : {len(skipped_unknown)} type(s) de node inconnu(s) skip(es) :\n'
            f'  {sorted(skipped_unknown)}\n'
            f'  -> Ces nodes viennent de custom nodes pas charges par ComfyUI.\n'
            f'  -> Si essentiels, installe les custom nodes manquants.',
            file=sys.stderr,
        )

    return api


def main():
    if len(sys.argv) < 3:
        print('Usage: python comfyui_gui_to_api.py <input_gui.json> <output_api.json> [comfy_url]', file=sys.stderr)
        sys.exit(2)
    gui_path = Path(sys.argv[1])
    api_path = Path(sys.argv[2])
    url = sys.argv[3] if len(sys.argv) > 3 else COMFY_URL

    if not gui_path.exists():
        print(f'[converter] ERREUR : {gui_path} introuvable.', file=sys.stderr)
        sys.exit(1)

    with gui_path.open(encoding='utf-8') as f:
        gui = json.load(f)

    object_info = fetch_object_info(url)
    api = convert(gui, object_info)

    api_path.parent.mkdir(parents=True, exist_ok=True)
    with api_path.open('w', encoding='utf-8') as f:
        json.dump(api, f, indent=2, ensure_ascii=False)

    print(f'[converter] OK : {len(api)} nodes -> {api_path}', file=sys.stderr)


if __name__ == '__main__':
    main()
