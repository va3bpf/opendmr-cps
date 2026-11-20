# OpenDMR CPS

[中文](README.md) · A codeplug editor in the browser for the **Baofeng DM-32 / DM-32UV** running the
[OpenDMR](https://github.com/va3bpf/OpenDMR) firmware.

Current version **0.7.1** ([changelog](CHANGELOG.md)).

## Features

- Channels (FM / DMR / P25 / AM / USB / LSB; the NAC of P25), zones, contacts, TG lists, APRS configurations, VFO A / B, callsign and DMR ID
- The radio's menu settings (general, radio, display, sound, APRS); power 50 mW – 10 W, each channel and VFO its own
- APRS: the configurations, with a list of the 94 symbols (primary and alternate tables)
- Amateur satellites: tick one to put it in the radio; orbits fetched by themselves (AMSAT / CelesTrak)
- DMR ID database: from a CSV (radioid.net's user.csv, downloaded with a click), by country; the radio
  then shows callers' callsigns, names, cities, states and countries (OpenDMR 0.4.0 and later; all the IDs fit, only
  what changed is written)
- Names written in GB2312, so Chinese names show on the radio
- Reads and writes the radio over the programming cable; a write changes only what was edited, the radio's other
  settings stay as they are
- CSV import / export in the OpenGD77 CPS's format (channels, zones, contacts, TG lists, APRS): OpenGD77's CSV files
  import as they are, a channel list from another CPS edited into this format too ([how](docs/csv.en.md))
- Radio themes: your own colours, the built-in ones recoloured or hidden, previewed on the radio's own screens
  (OpenDMR 0.6.0 and later)
- 中文 / English / Español interface, dark mode

## Flasher and backups

The **Flasher** page at the bottom of the sidebar:

- **Firmware update**: pick `opendmr.bin` and write it over the programming cable, without the PTT + SK1 upgrade
  mode. Only the firmware area (0xC000 and up) changes: the bootloader and the factory calibration stay as they are.
  Each sector is compared by CRC, only the different ones written, and all read back. The same protocol as
  `tools/debug/fw_update.py`.
- **The three backups**: the codeplug and settings (radio on, seconds), the program flash (1 MB: firmware and
  bootloader) and the data flash (16 MB: codeplug, settings, satellites and the factory calibration sector). The last
  two go through the chip bootloader: switch the radio off, the page waits for it at power on.
- **Writing a backup back**: only the sectors that differ are written, then all compared; writing the program flash
  leaves the bootloader below 0xC000 alone.

While the flasher works, a panel at the top of its page says what it is doing and how far it is, and the radio's
screen shows the same (title, "Do not power off", the percentage).
The page goes in three steps, in order: **1 the backups**, **2 install or update**, **3 back to the stock
firmware**, plus a **Log** card that can be saved to a file.
Three ways to write: **Update** (the sectors that differ), **Install / rewrite all** (the whole firmware area) and
**Bootloader** (radio off, then on): install OpenDMR on a stock radio (`opendmr.bin`, written from 0xC000) or go
back to factory (the radio's own program flash backup, plus the data flash one if wanted). The factory buttons
check they get the right file.

The two programs the radio runs are in `assets/` (`updater.bin`, `dumper.bin`): served from the folder
(`py serve.py`) the page reads those files; opened from disk (`opendmr-cps.html`, file:// does not allow reading
files) it uses identical copies embedded in the page. After rebuilding either, run `py tools/web/embed_bin.py`:
it updates `assets/` and the embedded copies together.

For a folder to upload: `py tools/web/make_folder.py` makes `dist/web/` (the page's sources + `js/` + `assets/`
+ `firmware/` + `serve.py`), ready for any HTTP server; the page reads `firmware/index.json` by itself.

To hand it to someone who does not know computers: `py tools/web/make_package.py` makes
`dist/paquete/OpenDMR-CPS/` (`Abrir CPS.bat`, `opendmr-cps.html`, the two bins in `programas/`, a formatted
`LEEME-PRIMERO.html` and the plain text one) and the same as a zip: unzip, double-click `Abrir CPS.bat`,
nothing to install.

## Use

1. Open it in **Chrome or Edge** (Web Serial), either way:
   - Download **`opendmr-cps.html`** from [Releases](../../releases) (or take the one in this repository) and
     double-click it: nothing to install. Satellite orbits come from CelesTrak / the TLE API
   - Double-click `start.bat` (or run `py serve.py`) and open `http://localhost:8000`: that also fetches AMSAT's orbits
2. Switch the radio on, plug in the programming cable, click "Connect" and pick the cable's serial port
3. "Read radio" → edit → "Write radio"; the radio restarts when written

Save a file first, as a backup.

## Licence

See [LICENSE](LICENSE): free to use and change, **non-commercial use only**.

## Development

The sources are `index.html`, `css/` and `js/`; open them through serve.py to debug (browsers do not load JS modules
from a file on disk).

- `py release.py`: makes the release page `opendmr-cps.html` (everything in one file, as small as it gets). Run it after
  changing the sources; needs `py -m pip install rjsmin rcssmin minify-html zopfli` first
- `py build.py`: makes a readable `opendmr-cps-debug.html`, to debug the page opened from disk
- `py tools/web/make_folder.py`: makes `dist/web/`, the page as a folder for a web server (modules + `assets/`);
  `py tools/web/embed_bin.py`: copies `tools/debug/updater/updater.bin` and `tools/backup/dumper/dumper.bin`
  to `assets/` and remakes the embedded copies
- tests (no radio): `node tools/web/tests/test-updater.mjs`, `test-bootloader.mjs`, `test-assets.mjs`, and
  `py build.py && node tools/web/tests/test-page.mjs` (needs jsdom)
