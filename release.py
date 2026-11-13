#!/usr/bin/env python3
"""Makes the release page opendmr-cps.html: the whole CPS in one file, as small as it gets, to open by double-clicking.

  py -m pip install rjsmin rcssmin minify-html zopfli     (once)
  py release.py

JS and CSS minified (rjsmin, rcssmin), put together and deflated (zopfli), written in Z85 (5 characters for 4 bytes)
and unpacked by the browser (DecompressionStream). `py build.py` makes the readable one, to debug.
"""
import re
import sys
import zlib

import build

try:
    import minify_html
    import rcssmin
    import rjsmin
    from zopfli.zopfli import compress as zopfli
except ImportError as e:
    sys.exit(f'{e.name} missing: py -m pip install rjsmin rcssmin minify-html zopfli')

OUT = build.ROOT / 'opendmr-cps.html'
Z85 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#'

# The loader: Z85 to bytes, inflated, the style put in and the page shown, the code run as a module
LOADER = ('<script>(async()=>{const A="%s",s="%s",b=new Uint8Array(s.length/5*4);'
          'for(let i=0,j=0;i<s.length;i+=5){let v=0;for(let k=0;k<5;k++)v=v*85+A.indexOf(s[i+k]);'
          'b[j++]=v>>>24;b[j++]=v>>16&255;b[j++]=v>>8&255;b[j++]=v&255}'
          'const t=await new Response(new Blob([b.subarray(0,%d)]).stream()'
          '.pipeThrough(new DecompressionStream("deflate-raw"))).text(),n=t.indexOf("\\0"),d=document,'
          'c=d.createElement("style"),m=d.createElement("script");c.textContent=t.slice(0,n);d.head.append(c);'
          'd.documentElement.style.visibility="visible";m.type="module";m.textContent=t.slice(n+1);d.body.append(m)})()'
          '</script>')


def z85(data):
    data += bytes(-len(data) % 4)
    out = []
    for i in range(0, len(data), 4):
        v = int.from_bytes(data[i:i + 4], 'big')
        out.append(''.join(Z85[v // 85 ** k % 85] for k in range(4, -1, -1)))
    return ''.join(out)


def nested_templates(js):
    """Lines with a template literal inside another's ${...}: rjsmin takes its text for code (spaces squeezed)."""
    found, stack, i, n, last = [], [], 0, len(js), ''
    while i < n:
        c = js[i]
        if c in ' \t\r\n':
            i += 1
        elif js.startswith('//', i):
            i = js.find('\n', i) % (n + 1)
        elif js.startswith('/*', i):
            i = js.index('*/', i) + 2
        elif c in '\'"':
            i += 1
            while js[i] != c:
                i += 2 if js[i] == '\\' else 1
            i, last = i + 1, 'a'
        elif c == '/' and (last in '(,=:[!&|?{};+-*%<>~^' or re.search(r'\b(return|typeof|case|of|in)$', js[max(0, i - 20):i].rstrip())):
            i, cls = i + 1, False
            while cls or js[i] != '/':
                cls = (js[i] == '[') or (cls and js[i] != ']')
                i += 2 if js[i] == '\\' else 1
            i, last = i + 1, 'a'
        elif c == '`' or (c == '}' and stack and stack[-1] == 0):
            if c == '`' and stack:
                found.append(js.count('\n', 0, i) + 1)
            if c == '}':
                stack.pop()
            i += 1
            while js[i] != '`':
                if js[i] == '\\':
                    i += 2
                elif js.startswith('${', i):
                    stack.append(0)
                    i += 2
                    break
                else:
                    i += 1
            else:
                i += 1
            last = 'a'
        else:
            if stack and c in '{}':
                stack[-1] += 1 if c == '{' else -1
            last = 'a' if (c.isalnum() or c in '_$') else c
            i += 1
    return found


def main():
    js = build.bundle(build.ROOT / 'js' / 'app.js')
    bad = nested_templates(js)
    if bad:
        sys.exit(f'nested template literals (bundle lines {bad}): rjsmin would change them, write them otherwise')
    js = rjsmin.jsmin(js)
    css = rcssmin.cssmin((build.ROOT / 'css' / 'app.css').read_text(encoding='utf-8'))
    data = (css + '\0' + js).encode('utf-8')
    packed = zopfli(data, numiterations=100)[2:-4]  # the zlib wrapping off: raw deflate
    assert zlib.decompressobj(-15).decompress(packed) == data
    text = z85(packed)
    assert not re.search(r'</script|<!--', text, re.I)  # cannot happen inside a script: Z85 has no such run here

    html = build.page_shell()
    html = html.replace(build.LINK, '<style>html{visibility:hidden}</style>').replace(build.SCRIPT, '<i id=load-here></i>')
    html = minify_html.minify(html, minify_css=True, keep_closing_tags=True, keep_html_and_head_opening_tags=True)
    assert html.count('<i id=load-here></i>') == 1, 'the loader place moved'
    html = html.replace('<i id=load-here></i>', LOADER % (Z85, text, len(packed)))
    OUT.write_text(html, encoding='utf-8', newline='\n')
    print(f'{OUT.name}: {len(html.encode()) / 1024:.1f} KB (code {len(data) / 1024:.1f} KB minified, '
          f'{len(packed) / 1024:.1f} KB packed)')


if __name__ == '__main__':
    main()
