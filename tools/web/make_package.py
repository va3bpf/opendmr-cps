#!/usr/bin/env python3
"""Makes dist/paquete/OpenDMR-CPS/: the folder to hand to someone, everything inside and nothing to install.

  py tools/web/make_package.py

  OpenDMR-CPS/
    Abrir CPS.bat        double-click: the page in Chrome or Edge (Firefox cannot use the cable)
    LEEME-PRIMERO.html   the guide (Spanish, then English), formatted
    LEEME-PRIMERO.txt    the same, plain text
    opendmr-cps.html     the whole CPS and the flasher in one file, with the firmware inside
                         (window.__OPENDMR_FIRMWARE): "Update" needs no file to look for

The page works from a disk file: the two radio-side programs are inside it. The folder is also written as
OpenDMR-CPS.zip, one file to send.
"""
import argparse
import base64
import hashlib
import io
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'dist' / 'paquete' / 'OpenDMR-CPS'
RELEASE_API = 'https://api.github.com/repos/va3bpf/OpenDMR/releases/latest'

BAT = r"""@echo off
rem OpenDMR CPS y flasher: abre la pagina en Chrome o Edge (Firefox no puede hablar por el cable)
cd /d "%~dp0"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome
set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome
set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome
set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge
rem sin Chrome ni Edge: el navegador predeterminado
start "" "%~dp0opendmr-cps.html"
exit /b
:chrome
start "" "%CHROME%" "%~dp0opendmr-cps.html"
exit /b
:edge
start "" "%EDGE%" "%~dp0opendmr-cps.html"
exit /b
"""

LEEME_TXT = """OpenDMR CPS + Flasher  (OpenDMR 0.6.1 en adelante)
==================================================

Que es
------
El programa (en el navegador) para la radio Baofeng DM-32 / DM-32UV con firmware OpenDMR: canales, zonas,
contactos, APRS, satelites, temas, y la pagina Flasher para actualizar y hacer las copias. Gratis, sin instalar nada.

Como se abre
------------
1. Descomprimi esta carpeta entera (no abrir el .html desde dentro del ZIP).
2. Doble clic en  "Abrir CPS.bat".
   Si el navegador no abre solo, doble clic en  "opendmr-cps.html"  (con Chrome o Edge).
3. Radio encendida y con el cable: en la pagina, arriba, "Conectar" y elegir el puerto (COM...).

En la pagina Flasher esta todo en tres pasos, en orden:

PASO 1 - Hacer las copias (antes de tocar nada)
-----------------------------------------------
  - Codeplug y ajustes   (radio encendida: segundos)
  - Flash de programa    (apagar la radio -> boton -> prenderla cuando lo pida, 30 s)
  - Flash de datos       (igual; 10 minutos o mas)
Guardar las tres, con el numero de serie de la radio: sin las dos flash no se puede volver atras.

PASO 2 - Instalar o actualizar
------------------------------
El firmware ya viene en la carpeta  firmware/  (opendmr-0.6.1.bin, con la version y el SHA-256 en el LEEME de
esa carpeta). En la pagina, tarjeta "Paso 2":
  - "Actualizar": solo escribe lo que cambia (radio que ya tiene OpenDMR, encendida).
  - "Instalar / reescribir todo": escribe todo el firmware (radio que ya tiene OpenDMR, encendida).
  - "Instalar OpenDMR en una radio original": para una radio que todavia tiene el firmware de fabrica; apagar la
    radio, apretar el boton y prenderla dentro de 30 segundos.
Otra version: https://github.com/va3bpf/OpenDMR/releases

PASO 3 - Volver al firmware original
------------------------------------
  - "Volver a fabrica": elegir la copia de "Flash de programa" (1 MB) de ESTA radio.
  - "Volver a fabrica (datos)": la copia de "Flash de datos" (16 MB) de ESTA radio.
Apagar la radio, apretar el boton y prenderla dentro de 30 segundos. Sin la copia no hay vuelta atras, y la de
otra radio no sirve.

Registro
--------
La pagina anota cada paso en la tarjeta "Registro" (hora, que se hizo, resultado). Si algo falla, "Guardar en un
archivo" y mandalo.

Aviso
-----
Actualizar tiene riesgo. Hacer las copias primero. La calibracion de fabrica es solo de esa radio.

--------------------------------------------------

English
-------
Unzip the whole folder, then double-click "Abrir CPS.bat" (or "opendmr-cps.html" in Chrome or Edge).
Switch the radio on, plug the programming cable, click "Connect" and pick the port.
The Flasher page does everything in three steps, in order: 1 the backups (codeplug, program flash, data flash),
2 install or update (the firmware is in firmware/; a stock radio uses "Install OpenDMR on a stock radio"), 3 back
to the stock firmware from this radio's own backups. Keep the backups with the radio's serial number: a backup only
fits its own radio. Every step is in the page's Log card: if something fails, save it and send it.
"""


LEEME_HTML = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenDMR CPS — cómo empezar</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 18px 56px; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         max-width: 820px; margin-inline: auto; background: #fff; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16181c; color: #e6e6e6; } }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 34px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #0002; }
  @media (prefers-color-scheme: dark) { h2 { border-color: #fff2; } }
  p, li { margin: 8px 0; }
  ol, ul { padding-left: 24px; }
  ol.steps > li { margin: 12px 0; }
  code, kbd { font: 0.92em ui-monospace, Consolas, monospace; background: #0001; padding: 1px 6px; border-radius: 5px; }
  @media (prefers-color-scheme: dark) { code, kbd { background: #fff2; } }
  .btn { display: inline-block; padding: 2px 8px; border: 1px solid #0003; border-radius: 7px; font-weight: 600; }
  @media (prefers-color-scheme: dark) { .btn { border-color: #fff3; } }
  .box { border: 1px solid #0002; border-left: 4px solid #2563eb; border-radius: 10px; padding: 12px 16px; margin: 16px 0;
         background: #2563eb0d; }
  .warn { border-left-color: #d97706; background: #d977060f; }
  .bad { border-left-color: #dc2626; background: #dc26260f; }
  @media (prefers-color-scheme: dark) { .box { border-color: #fff2; } }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 15px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #0002; vertical-align: top; }
  @media (prefers-color-scheme: dark) { th, td { border-color: #fff2; } }
  th { font-weight: 600; }
  .muted { opacity: .75; font-size: 14px; }
  .file { font-weight: 600; }
  hr { border: 0; border-top: 1px solid #0002; margin: 40px 0; }
  @media (prefers-color-scheme: dark) { hr { border-color: #fff2; } }
</style>
</head>
<body>

<h1>OpenDMR CPS</h1>
<p class="muted">Para la radio <b>Baofeng DM-32 / DM-32UV</b> con firmware <b>OpenDMR 0.6.1</b> o posterior.<br>
Gratis, no hay que instalar nada.</p>

<div class="box">
  <b>En una frase:</b> es el programa para configurar la radio desde la computadora (canales, contactos, APRS,
  satélites) y, en la pestaña <b>Flasher</b>, actualizar el firmware y hacer las <b>copias de seguridad</b>.
</div>

<h2>Abrir la página</h2>
<ol class="steps">
  <li>Descomprimí <b>toda la carpeta</b> (no abras el <code>.html</code> desde adentro del ZIP).</li>
  <li>Doble clic en <span class="file btn">Abrir CPS.bat</span>.<br>
      Si no abre, doble clic en <span class="file">opendmr-cps.html</span> con <b>Chrome</b> o <b>Edge</b>
      (Firefox no sirve: no puede hablar por el cable).</li>
  <li>En la página, arriba a la derecha, apretá <span class="btn">Conectar</span> y elegí el puerto del cable
      (<code>COM…</code>). La radio tiene que estar <b>encendida</b> y con el cable puesto.</li>
</ol>
<p class="muted">Sólo la primera vez: el navegador pide permiso para usar el puerto. Aceptá.</p>

<h2>Paso 1 · Hacer las copias</h2>
<p>Andá a la pestaña <b>Flasher</b> (última de la barra de la izquierda) → tarjeta <b>«Las tres copias»</b>.
Hacé las tres, en este orden:</p>
<table>
  <tr><th>Botón</th><th>Cómo</th><th>Cuánto tarda</th></tr>
  <tr><td><b>Codeplug y ajustes</b></td><td>Radio encendida, conectada.</td><td>segundos</td></tr>
  <tr><td><b>Flash de programa</b></td><td>Apagá la radio → apretá el botón → <b>prendela</b> cuando la página lo pida
      (30 segundos). Pantalla negra y LED apagado es lo correcto.</td><td>≈ 1 minuto</td></tr>
  <tr><td><b>Flash de datos (16 MB)</b></td><td>Igual: apagada, botón, encendida.</td><td>10 minutos o más</td></tr>
</table>
<div class="warn box">
  Guardá las tres en un lugar seguro y anotá el <b>número de serie de la radio</b>. Cada radio tiene su propia
  calibración de fábrica: el backup de una <b>no sirve</b> para otra.
</div>

<h2>Paso 2 · Instalar o actualizar</h2>
<ol class="steps">
  <li><b>Ya viene en este paquete</b>: <code>firmware/opendmr-0.6.1.bin</code> (adentro de esa carpeta está la
      versión y el SHA-256). Si querés otra versión, bajala de las releases de OpenDMR:
      <a href="https://github.com/va3bpf/OpenDMR/releases">github.com/va3bpf/OpenDMR/releases</a>
      (es el <code>opendmr.bin</code>, <b>no</b> el que dice BFUV32).</li>
  <li>En <b>Flasher</b> → <b>«Actualización de firmware»</b>: <span class="btn">Elegir firmware…</span> y elegí
      <code>firmware/opendmr-0.6.1.bin</code>.</li>
  <li>Apretá <span class="btn">Actualizar</span>. La radio se reinicia sola al terminar.</li>
</ol>
<p class="muted">Sólo cambia el área de firmware: el bootloader y la calibración no se tocan. Cada sector se compara
primero, así que si ya está esa versión escribe 0 sectores. <b>No</b> transmitas mientras actualiza, y no la apagues
en el medio.</p>

<h2>Paso 3 · Volver al firmware original</h2>
<p>Estas dos van por el <b>bootloader</b>: la radio <b>apagada</b>, apretás el botón y la <b>prendés</b> cuando la página
lo pida (30 segundos; pantalla negra y LED apagado es lo correcto).</p>
<table>
  <tr><th>Botón</th><th>Archivo que pide</th><th>Cuándo</th></tr>
  <tr><td><b>Instalar OpenDMR en una radio original</b></td><td><code>firmware/opendmr-0.6.1.bin</code></td>
      <td>la radio todavía tiene el firmware de fábrica (el de Baofeng)</td></tr>
  <tr><td><b>Volver a fábrica</b></td><td>la copia de <b>Flash de programa</b> de <b>esta</b> radio (1 MB)</td>
      <td>querés dejar la radio como vino de fábrica</td></tr>
  <tr><td><b>Volver a fábrica (datos)</b></td><td>la copia de <b>Flash de datos</b> de <b>esta</b> radio (16 MB)</td>
      <td>además querés el codeplug y la calibración originales</td></tr>
</table>
<div class="bad box">
  <b>Sin la copia no hay vuelta atrás.</b> La de otra radio no sirve: cada radio tiene su calibración. Por eso las tres
  copias se hacen <b>antes</b> de tocar nada.
</div>

<h2>Si algo no anda</h2>
<table>
  <tr><th>Qué pasa</th><th>Qué mirar</th></tr>
  <tr><td>No aparece ningún <code>COM…</code></td><td>Driver del cable CH340 (buscá «CH340 driver»), cable bien puesto,
      y usá Chrome o Edge.</td></tr>
  <tr><td>«No conecta» o se corta</td><td>Cerrá el CPS oficial u otro programa que use el puerto; probá otro cable USB.</td></tr>
  <tr><td>Al actualizar dice «no answer»</td><td>La radio tiene que estar <b>encendida</b> y con el firmware de OpenDMR
      (no el original) para el modo por cable.</td></tr>
  <tr><td>La copia de las flash no arranca</td><td>Hay que apagarla y prenderla <b>después</b> de apretar el botón,
      dentro de los 30 segundos.</td></tr>
  <tr><td>El PTT del satélite hace un tono de error</td><td>Falta la configuración APRS con el nombre del satélite
      (<code>ISS</code>) o la posición.</td></tr>
</table>

<div class="box">
  <b>Registro:</b> la página anota cada paso en la tarjeta <b>«Registro»</b> (hora, qué se hizo, resultado).
  Si algo falla, apretá <b>«Guardar en un archivo»</b> y mandá ese archivo.
</div>

<div class="bad box">
  <b>Aviso:</b> actualizar el firmware tiene riesgo. Hacé las tres copias primero. Si algo sale mal, la radio se
  recupera con el modo upgrade original (radio apagada, encendida con <b>PTT + SK1</b>) y las copias.
</div>

<hr>

<h2>English</h2>
<ol class="steps">
  <li>Unzip the whole folder, then double-click <span class="file btn">Abrir CPS.bat</span>
      (or open <span class="file">opendmr-cps.html</span> in Chrome or Edge — not Firefox).</li>
  <li>Switch the radio on, plug the programming cable, click <span class="btn">Connect</span> and pick the
      <code>COM…</code> port.</li>
  <li>Before flashing anything, open <b>Flasher</b> and make the three backups (codeplug, program flash, data flash);
      keep them with the radio's serial number: a backup only fits its own radio.</li>
  <li>The firmware comes in this package: <code>firmware/opendmr-0.6.1.bin</code> (its LEEME has the version and
      the SHA-256); in the flasher, "Choose firmware…" and pick it. Other versions:
      <a href="https://github.com/va3bpf/OpenDMR/releases">github.com/va3bpf/OpenDMR/releases</a> (not the BFUV32 one).</li>
</ol>
<p class="muted">The two radio-side programs are inside the page; they are loaded into the radio's RAM, not the
flash. Every step is written to the page's <b>Log</b> card: if something fails, save it and send it.</p>

</body>
</html>
"""


def find_firmware(given=None):
    """The firmware to put in the package: the file given, the one in firmware/ of this repository, or opendmr.bin from
    the latest OpenDMR release. Returns (name, bytes)."""
    if given:
        path = Path(given)
        return path.name, path.read_bytes()
    local = sorted((ROOT / 'firmware').glob('*.bin')) if (ROOT / 'firmware').exists() else []
    if local:
        return local[0].name, local[0].read_bytes()
    print('firmware: fetching the latest release from GitHub ...')
    request = urllib.request.Request(RELEASE_API, headers={'User-Agent': 'opendmr-cps'})
    with urllib.request.urlopen(request, timeout=60) as reply:
        release = json.load(reply)
    tag = release['tag_name']
    asset = next(a for a in release['assets'] if a['name'].endswith('.zip'))
    with urllib.request.urlopen(urllib.request.Request(asset['browser_download_url'],
                                                       headers={'User-Agent': 'opendmr-cps'}), timeout=600) as reply:
        data = reply.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        member = next(n for n in z.namelist() if n.endswith('/opendmr.bin'))
        return f'opendmr-{tag[1:]}.bin' if tag.startswith('v') else 'opendmr.bin', z.read(member)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--firmware', help='opendmr.bin to put in the package (default: the latest release)')
    args = ap.parse_args()

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    (OUT / 'firmware').mkdir()
    # the page: the packed release with the firmware inside, so the flasher's buttons work with nothing to look for
    firmware_name, firmware = find_firmware(args.firmware)
    page = (ROOT / 'opendmr-cps.html').read_text(encoding='utf-8')
    payload = json.dumps({'name': firmware_name, 'b64': base64.b64encode(firmware).decode('ascii')})
    injected = ('<script>/* the firmware this package carries (make_package.py) */'
                f'window.__OPENDMR_FIRMWARE = {payload};</script>')
    assert '<body>' in page, 'the packed page has no <body>'
    (OUT / 'opendmr-cps.html').write_text(page.replace('<body>', '<body>' + injected, 1),
                                          encoding='utf-8', newline='\n')
    (OUT / 'firmware' / firmware_name).write_bytes(firmware)
    digest = hashlib.sha256(firmware).hexdigest()
    (OUT / 'firmware' / 'LEEME.txt').write_text(
        f'{firmware_name}\n\n'
        f'Firmware de OpenDMR ({len(firmware)} bytes, de la release oficial de va3bpf/OpenDMR).\n'
        f'SHA-256: {digest}\n\n'
        'En la pagina: Flasher -> "Elegir firmware..." y elegi este archivo.\n'
        'Es el opendmr.bin, no el que dice BFUV32.\n',
        encoding='utf-8', newline='\r\n')
    print(f'firmware: {firmware_name} ({len(firmware)} bytes)')

    (OUT / 'LEEME-PRIMERO.txt').write_text(LEEME_TXT, encoding='utf-8', newline='\r\n')
    (OUT / 'LEEME-PRIMERO.html').write_text(LEEME_HTML, encoding='utf-8', newline='\r\n')
    (OUT / 'Abrir CPS.bat').write_text(BAT, encoding='utf-8', newline='\r\n')
    total = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
    print(f'{OUT}: {len(list(OUT.rglob("*")))} entries, {total / 1024:.0f} KB')

    zipped = OUT.parent / 'OpenDMR-CPS.zip'
    with zipfile.ZipFile(zipped, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(OUT.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(OUT.parent))
    print(f'{zipped}: {zipped.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
