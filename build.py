#!/usr/bin/env python3
"""Builds opendmr-cps-debug.html: the whole CPS in one file, readable, to debug the page opened from disk.

  py build.py

release.py makes the release page (opendmr-cps.html) from the same bundle, packed small.

Chrome and Edge give a file:// page the serial port, but not the JS modules it imports: here they go in the page, each
module wrapped in a function giving its exports. Only the forms this code uses are handled: `import {a, b as c} from
'./x.js'`, `import * as X from './x.js'`, and `export` before function, async function, class and const.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / 'opendmr-cps-debug.html'
LINK = '<link rel="stylesheet" href="css/app.css">'
SCRIPT = '<script type="module" src="js/app.js"></script>'

IMPORT = re.compile(r"^import\s+(\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'([^']+)';\s*$", re.M)
EXPORT = re.compile(r'^export\s+(?:async\s+function\*?|function\*?|class|const|let)\s+(\w+)', re.M)


def var(path):
    return '__' + re.sub(r'\W', '_', path.relative_to(ROOT / 'js').with_suffix('').as_posix())


def bundle(entry):
    done, order = set(), []

    def visit(path):
        if path in done:
            return
        done.add(path)
        text = path.read_text(encoding='utf-8')
        for m in IMPORT.finditer(text):
            visit((path.parent / m.group(4)).resolve())
        order.append((path, text))

    visit(entry.resolve())
    parts = []
    for path, text in order:
        def imp(m):
            source = var((path.parent / m.group(4)).resolve())
            if m.group(2):
                return f'const {m.group(2)} = {source};'
            names = [n.strip() for n in m.group(3).split(',') if n.strip()]
            return 'const {%s} = %s;' % (', '.join(re.sub(r'\s+as\s+', ': ', n) for n in names), source)

        names = EXPORT.findall(text)
        body = EXPORT.sub(lambda m: m.group(0)[len('export'):].lstrip(), IMPORT.sub(imp, text))
        if re.search(r'^\s*(import|export)\b', body, re.M):
            sys.exit(f'{path}: an import or export this script does not know')
        is_entry = path == entry.resolve()
        parts.append(f'// ---- {path.relative_to(ROOT).as_posix()} ----\n' +
                     (body if is_entry else
                      f'const {var(path)} = (() => {{\n{body}\nreturn {{{", ".join(names)}}};\n}})();\n'))
    return '\n'.join(parts)


def page_shell():
    """index.html without the note for its opening from disk, and a word that it is made"""
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    assert html.count(LINK) == 1 and html.count(SCRIPT) == 1
    html, hints = re.subn(r'<script id="file-hint">.*?</script>\n', '', html, flags=re.S)
    assert hints == 1
    return html.replace('<head>', '<head>\n<!-- made by build.py / release.py from index.html, css/ and js/: edit those -->', 1)


def main():
    css = (ROOT / 'css' / 'app.css').read_text(encoding='utf-8')
    js = bundle(ROOT / 'js' / 'app.js').replace('</script', '<\\/script')
    html = page_shell().replace(LINK, f'<style>\n{css}</style>').replace(SCRIPT, f'<script type="module">\n{js}</script>')
    OUT.write_text(html, encoding='utf-8', newline='\n')
    print(f'{OUT.name}: {OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
