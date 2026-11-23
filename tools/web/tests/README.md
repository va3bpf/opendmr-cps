# Web tests (no radio needed)

The flasher's protocols, run against simulated radios (Node 18 or later).

```bash
node tools/web/tests/test-updater.mjs     # the update program protocol (js/radio/updater.js)
node tools/web/tests/test-bootloader.mjs  # the chip bootloader, read, check and restore (js/radio/bootloader.js)
node tools/web/tests/test-screen.mjs      # the 'T' text frames for the radio's screen (js/radio/screen.js)
```

The simulated radios are in the test files: `SimRadio` answers the update program's requests (`DUUPD!`, `L`, `J`, `S`,
`C`, `W`, `P`, `B`), `SimBoot` answers the chip bootloader's (`02 24 00 03`, the 256-byte blocks, `DMP1`, `R`, `C`, `X`).
They check what the page writes and reads, not the radio's own behaviour: for that, OpenDMR's `tools/debug/fw_update.py`
and `tools/backup/dm32_dump.py` speak the same protocols.
