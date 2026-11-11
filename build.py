"""Build browser packages from extension/: python build.py

dist/firefox/   + dist/mini-browser-mcp-<version>-firefox.xpi   (Firefox, Zen, other Gecko browsers)
dist/chrome/    + dist/mini-browser-mcp-<version>-chrome.zip    (Chrome, Edge, Brave, Arc, ...)

Each package gets its own manifest so neither browser warns about keys it does not know:
Firefox has no `debugger` permission or service worker; Chrome has no `background.scripts`
or `browser_specific_settings`.
"""
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / 'extension'
DIST = ROOT / 'dist'

base = json.loads((SRC / 'manifest.json').read_text(encoding='utf8'))
version = base['version']


def firefox(m):
    m = json.loads(json.dumps(m))
    m['permissions'] = [p for p in m['permissions'] if p != 'debugger']
    m['background'] = {'scripts': ['background.js']}
    return m


def chrome(m):
    m = json.loads(json.dumps(m))
    m['background'] = {'service_worker': 'background.js'}
    m.pop('browser_specific_settings', None)
    return m


if DIST.exists():
    shutil.rmtree(DIST)
for name, make, ext in [('firefox', firefox, 'xpi'), ('chrome', chrome, 'zip')]:
    out = DIST / name
    out.mkdir(parents=True)
    for f in SRC.iterdir():
        if f.is_file() and f.name != 'manifest.json':
            shutil.copy2(f, out / f.name)
    (out / 'manifest.json').write_text(json.dumps(make(base), indent=2) + '\n', encoding='utf8')
    # Forward slashes and manifest.json at the root: Firefox rejects zips built otherwise.
    pkg = DIST / f'mini-browser-mcp-{version}-{name}.{ext}'
    with zipfile.ZipFile(pkg, 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(out.iterdir()):
            z.write(f, f.name)
    print(pkg)
