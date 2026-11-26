#!/usr/bin/env python3
"""Builds the flash page for the FM-1 Loop Station firmware.

usage: make_flash_page.py <firmware dir> <out.html> [source url]

Takes the package that firmware/sdk/Build.ps1 -FirmwareOnly produced (build/dx7/generated/FM1_OFFICIAL_OPEN.fwsc and
build/dx7/build-identity.json) and fills M-VAVE's update page template (sdk/Update.html.in) the way
tools/Build-Web.ps1 -PackageJson does. The browser simulator is left out (it needs a WebAssembly toolchain);
the page updates the FM-1 and can go back to the original V15.
"""
import base64, hashlib, html, json, os, re, sys

root, out = sys.argv[1], sys.argv[2]
src_url = sys.argv[3] if len(sys.argv) > 3 else 'https://github.com/brotschuh/fm1-loopstation'
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
rb = lambda p: open(os.path.join(root, p), 'rb').read()
sha = lambda b: hashlib.sha256(b).hexdigest()

ver = rd('app/version.h')
release = re.search(r'#define FM1_RELEASE_VERSION "(V\d+)"', ver).group(1)
product = re.search(r'#define FM1_UPDATE_PRODUCT "(FM-1_8\d{6})"', ver).group(1)
fw = rb('build/dx7/generated/FM1_OFFICIAL_OPEN.fwsc')
ident = json.loads(open(os.path.join(root, 'build/dx7/build-identity.json'), encoding='utf-8-sig').read())
build_id = ident['build_id']
assert re.fullmatch(r'[0-9a-f]{64}', build_id), build_id
assert ident['release_version'] == release

stock = rb('sdk/firmware/FM-1_015.fwsc')
assert sha(stock) == 'db1642b2b6fa5c2cccb11ffd13878068bb28601678d3644049f99dc40e7edb8a', 'original V15 image changed'

package = dict(schema=1, product=product, profile='dx7', family=7, release_version=release, build_id=build_id,
               sha256=sha(fw), bytes=len(fw), loader_sha256=sha(rb('sdk/tools/pack/ota.bin')), hardware_validated=False,
               data=base64.b64encode(fw).decode(),
               stock=dict(schema=1, kind='stock', product='FM-1_015', profile='M-VAVE Original V15', family=7,
                          release_version='V15', build_id=sha(stock), sha256=sha(stock), bytes=len(stock),
                          loader_sha256='ef1f2db89b011fa53e71df363f0122de0ea896618c53fb53e8da676322004541',
                          data=base64.b64encode(stock).decode()))
simulator = dict(schema=1, release_version=release, sha256='0' * 64, source_sha256='0' * 64, sample_bank='none', data='')

notices = ['APP: GPLv3 with the FM1 SDK linking exception; no warranty. SDK and firmware resources have separate '
           'redistribution terms in THIRD_PARTY.md. Source: ' + src_url,
           'FM-1 V15 recovery firmware: https://www.m-vave.com/download (PC Firmware / FM-1 V15). Distributed by M-VAVE '
           'under Apache-2.0. Retain applicable licenses and notices; components with separate licenses retain their terms. '
           'See THIRD_PARTY.md.']
for f in ('THIRD_PARTY.md', 'LICENSE.md'):
    notices.append('\n===== %s =====\n%s' % (f, rd(f)))

page = rd('sdk/Update.html.in')
for key, value in {
    '/*FM1_SOURCE_URL*/': html.escape(src_url),
    '/*FM1_PAYLOAD*/': 'const FM1_PACKAGE = ' + json.dumps(package, separators=(',', ':')) + ';',
    '/*FM1_SIMULATOR*/': 'const FM1_SIMULATOR = ' + json.dumps(simulator, separators=(',', ':')) + ';',
    '/*FM1_I18N*/': rd('sdk/I18n.js'), '/*FM1_SCRIPT*/': rd('sdk/WebUpdate.js'),
    '/*FM1_SIM_SCRIPT*/': rd('sdk/Simulator.js'), '/*FM1_SAMPLE_SCRIPT*/': rd('sdk/Samples.js'),
    '/*FM1_NOTICES*/': html.escape('\n'.join(notices)),
}.items():
    page = page.replace(key, value)
assert not re.search(r'/\*FM1_[A-Z_]+\*/', page), 'unexpanded placeholder'
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
open(out, 'w', encoding='utf-8', newline='\n').write(page)
print('flash page', out, len(page), 'bytes; firmware', len(fw), 'bytes, sha256', sha(fw)[:16], 'build', build_id[:16])
