# OpenDMR CPS

[中文](README.md) · A codeplug editor in the browser for the **Baofeng DM-32 / DM-32UV** running the
[OpenDMR](https://github.com/va3bpf/OpenDMR) firmware.

Current version **0.12.0** ([changelog](CHANGELOG.md)).

## Features

- Channels (FM / DMR / P25 / NXDN / M17 / AM / USB / LSB; the NAC of P25, the RAN of NXDN, the CAN of M17), zones, contacts, TG lists, APRS configurations, VFO A / B, callsign and DMR ID
- The radio's menu settings (general, radio, display, sound, APRS); power 50 mW – 10 W, each channel and VFO its own
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
- Interface languages: the languages of the OpenDMR zip's languages folder (Chinese, Spanish, ...) and the
  fonts they need, written to the radio (OpenDMR 0.8.0 and later)
- 中文 / English / Español interface, dark mode
- Choose APRS symbols from the standard primary `/` and alternate `\` tables; the radio's original symbol codes remain unchanged when reading and writing

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
