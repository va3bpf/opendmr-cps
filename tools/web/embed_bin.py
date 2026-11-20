#!/usr/bin/env python3
"""Embeds the radio-side binaries the flasher needs into JS modules (base64) and copies them to assets/, so a page
served from this folder reads the real files and one opened from disk still has them.

  py tools/web/embed_bin.py

  tools/debug/updater/updater.bin -> js/radio/updater-bin.js   (UPDATER_BIN)   and assets/updater.bin
  tools/backup/dumper/dumper.bin  -> js/radio/dumper-bin.js    (DUMPER_BIN)    and assets/dumper.bin

Both were built from src/ (updater/updater.c, tools/backup/dumper/dumper.c) and are kept in git; run this after
rebuilding either.
"""
import base64
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

FILES = [
    ('tools/debug/updater/updater.bin', 'js/radio/updater-bin.js', 'UPDATER_BIN', 'assets/updater.bin',
     'The firmware update program (tools/debug/updater/updater.c), loaded into the radio\'s RAM by its loader.'),
    ('tools/backup/dumper/dumper.bin', 'js/radio/dumper-bin.js', 'DUMPER_BIN', 'assets/dumper.bin',
     'The flash reader (tools/backup/dumper/dumper.c), loaded into the radio\'s RAM by the chip bootloader.'),
]


def wrap(text, width=96):
    return '\n'.join("    '%s' +" % text[i:i + width] for i in range(0, len(text), width))[:-1]


def main():
    (ROOT / 'assets').mkdir(exist_ok=True)
    for source, target, name, asset, doc in FILES:
        data = (ROOT / source).read_bytes()
        shutil.copyfile(ROOT / source, ROOT / asset)
        text = base64.b64encode(data).decode('ascii')
        out = (f'// {doc}\n'
               f'// {source}, {len(data)} bytes, base64: the copy for a page opened from disk (file://). Served from\n'
               f'// this folder, the page reads {asset} instead (js/radio/assets.js). Made by tools/web/embed_bin.py:\n'
               f'// do not edit.\n\n'
               f'export const {name} = (\n{wrap(text)}\n);\n\n'
               f'// The image as bytes\n'
               f'export function {name.lower()}() {{\n'
               f'    const bin = atob({name});\n'
               f'    const out = new Uint8Array(bin.length);\n'
               f'    for (let i = 0; i < bin.length; i++) {{\n'
               f'        out[i] = bin.charCodeAt(i);\n'
               f'    }}\n'
               f'    return out;\n'
               f'}}\n')
        (ROOT / target).write_text(out, encoding='utf-8', newline='\n')
        print(f'{asset}: {len(data)} bytes; {target} made')


if __name__ == '__main__':
    main()
