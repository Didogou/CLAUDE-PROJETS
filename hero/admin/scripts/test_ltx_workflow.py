"""Test : poste le workflow LTX 2.3 directement a ComfyUI pour voir les
node_errors exacts. Aide a debug sans passer par Next."""
import json, sys, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')

with open('src/lib/workflows/ltx_2_3_dual.api.json', encoding='utf-8') as f:
    api_wf = json.load(f)

print(f'Loaded {len(api_wf)} nodes')

# Submit a /api/prompt
body = json.dumps({'prompt': api_wf, 'client_id': 'hero-test'}).encode('utf-8')
req = urllib.request.Request(
    'http://127.0.0.1:8188/prompt',
    data=body,
    headers={'Content-Type': 'application/json'},
)
try:
    with urllib.request.urlopen(req, timeout=10) as r:
        resp = json.load(r)
    print('=== Response ===')
    print(json.dumps(resp, indent=2, ensure_ascii=False))
    if resp.get('node_errors'):
        print('\n=== NODE ERRORS DETAILS ===')
        for nid, errs in resp['node_errors'].items():
            print(f'\nNode {nid} ({errs.get("class_type", "?")}):')
            for e in errs.get('errors', []):
                print(f'  - {e.get("type")}: {e.get("message")}')
                if e.get('details'):
                    print(f'    details: {e["details"]}')
                if e.get('extra_info'):
                    print(f'    extra: {e["extra_info"]}')
except urllib.error.HTTPError as e:
    body = e.read().decode('utf-8', errors='replace')
    print(f'HTTP {e.code}:')
    try:
        data = json.loads(body)
        print(json.dumps(data, indent=2, ensure_ascii=False))
    except json.JSONDecodeError:
        print(body)
except Exception as e:
    print(f'ERROR: {type(e).__name__}: {e}')
