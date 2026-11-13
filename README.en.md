# OpenDMR CPS

[中文](README.md) · A codeplug editor in the browser for the **Baofeng DM-32 / DM-32UV** running the
[OpenDMR](https://github.com/va3bpf/OpenDMR) firmware.

Current version **0.4.0** ([changelog](CHANGELOG.md)).

## Features

- Channels (FM / DMR / P25 / AM / USB / LSB; the NAC of P25), zones, contacts, TG lists, VFO A / B, callsign and DMR ID
- The radio's menu settings (general, radio, display, sound, APRS); power 50 mW – 10 W, each channel and VFO its own
- Amateur satellites: tick one to put it in the radio; orbits fetched by themselves (AMSAT / CelesTrak)
- Names written in GB2312, so Chinese names show on the radio
- Reads and writes the radio over the programming cable; a write changes only what was edited, the radio's other
  settings stay as they are
- Codeplug files: save / open
- 中文 / English interface, dark mode

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
