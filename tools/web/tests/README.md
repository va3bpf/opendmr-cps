# Web tests (no radio needed)

The flasher's protocols, run against simulated radios, and the page rendered in jsdom.

```bash
node tools/web/tests/test-updater.mjs     # the update program protocol (js/radio/updater.js)
node tools/web/tests/test-bootloader.mjs  # the chip bootloader, read and restore (js/radio/bootloader.js)
node tools/web/tests/test-assets.mjs      # assets/ read when served, the embedded copy from disk (js/radio/assets.js)
node tools/web/tests/test-screen.mjs      # the 'T' text frames for the radio's screen (js/radio/screen.js)
py build.py && node tools/web/tests/test-page.mjs   # the page: the flasher tab, the languages (needs jsdom)
```

`test-page.mjs` needs jsdom (`npm install jsdom`); without it the test says so and skips.

The simulated radios are in the test files: `SimRadio` answers the update program's requests (`DUUPD!`, `L`, `J`, `S`,
`C`, `W`, `P`, `B`), `SimBoot` answers the chip bootloader's (`02 24 00 03`, the 256-byte blocks, `DMP1`, `R`, `C`, `X`).
They check what the page writes and reads, not the radio's own behaviour: for that, `tools/debug/fw_update.py` and
`tools/backup/dm32_dump.py` are the same protocols.
