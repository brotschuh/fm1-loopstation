#!/usr/bin/env python3
"""Builds dist/ouroloops.html: one self-contained page (engine + worklet as text, drums, FM-1 link, app)."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text()
parts = {'I18N': 'i18n.js', 'FXCHAIN': 'fxchain.js', 'SAVE': 'save.js', 'ROCK': 'rockkit.js', 'ENGINE': 'engine.js', 'WORKLET': 'worklet.js', 'DRUMS': 'drums.js', 'FM1': 'fm1.js', 'APP': 'app.js'}
for key, name in parts.items():
    code = (src / name).read_text()
    assert '</script' not in code, name
    html = html.replace(f'/*{key}*/', code)
for out in (root / 'dist' / 'ouroloops.html', root / 'docs' / 'index.html'):   # docs/ = the GitHub Pages site
    out.parent.mkdir(exist_ok=True)
    page = html
    if out.parent.name == 'dist':   # the single file has no manifest and icons next to it
        page = '\n'.join(l for l in html.split('\n') if not (l.startswith('<link rel="manifest"') or l.startswith('<link rel="icon"') or l.startswith('<link rel="apple-touch-icon"')))
    out.write_text(page)
    print('built', out, len(page), 'bytes')
