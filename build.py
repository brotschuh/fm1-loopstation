#!/usr/bin/env python3
"""Builds dist/fm1-loopstation.html: one self-contained page (engine + worklet as text, drums, FM-1 link, app)."""
import pathlib
root = pathlib.Path(__file__).parent
src = root / 'src'
html = (src / 'index.html').read_text()
parts = {'I18N': 'i18n.js', 'ROCK': 'rockkit.js', 'ENGINE': 'engine.js', 'WORKLET': 'worklet.js', 'DRUMS': 'drums.js', 'FM1': 'fm1.js', 'APP': 'app.js'}
for key, name in parts.items():
    code = (src / name).read_text()
    assert '</script' not in code, name
    html = html.replace(f'/*{key}*/', code)
for out in (root / 'dist' / 'fm1-loopstation.html', root / 'docs' / 'index.html'):   # docs/ = the GitHub Pages site
    out.parent.mkdir(exist_ok=True)
    out.write_text(html)
    print('built', out, len(html), 'bytes')
