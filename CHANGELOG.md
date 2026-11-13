# Changelog / 版本记录

## 0.4.0 (2026-11-12)

- P25 channels and VFOs (firmware with P25): the mode P25, its NAC (12 bits in hex, 293 by default, F7E receives any)
  in place of the colour code and timeslot; the contact and TG list as for DMR. Stored as the firmware does: a digital
  channel with byte 37 = 0xA4, the NAC in bytes 44 (low 8 bits) and 42 (high 4, tagged 0xA0). The OpenGD77 CPS shows
  such a channel as DMR.
  P25 信道和 VFO（支持 P25 的固件）：模式 P25，NAC（12 位十六进制，默认 293，F7E 收所有）代替色码和时隙；联系人和
  组列表同 DMR。存法和固件一致：数字信道，第 37 字节 0xA4，NAC 在第 44 字节（低 8 位）和第 42 字节（高 4 位，标记
  0xA0）。OpenGD77 的 CPS 会把这种信道显示成 DMR。
- Power levels of the firmware after 0.2.0: 50mW, 500mW, 1W, 2W, 3W, 4W, 5W, 7W, 10W, +W- (1W / 4W / 10W the stock
  Low / Middle / High; the same codeplug byte was named 50mW - 5W before). VFO A / B have their own power; Radio
  settings has the default power, which a new channel starts with, and a button to apply it to every channel and VFO.
  The unused power class (5W / 10W) setting is gone. A VFO not valid in the file (a new codeplug) is a plain default
  one, not Rx only with VOX and a 3825 s TOT.
  固件 0.2.0 之后的功率档：50mW、500mW、1W、2W、3W、4W、5W、7W、10W、+W-（1W / 4W / 10W 为原厂低 / 中 / 高）。
  VFO A / B 各有自己的功率；电台设置里有默认功率（新建信道从它复制），并可一键应用到所有信道和 VFO。去掉了没用的
  「功率档 5W/10W」设置。新码表里无效的 VFO 改为正常的默认值（不再是只收、声控、TOT 3825 秒）。
- `opendmr-cps.html`: the whole CPS in one file, opened by double-clicking it (made by `release.py`: minified and packed, 44 KB); `start.bat` starts
  serve.py and opens the page. Opening `index.html` from disk now says how to open it instead.
  `opendmr-cps.html`：整个 CPS 合成一个文件，双击即可使用（由 `release.py` 生成，压缩后 44 KB）；`start.bat` 启动 serve.py 并打开页面。
  从磁盘直接打开 `index.html` 时会提示正确的打开方式。

## 0.3.0 (2026-11-10)

- Satellites, simpler: one table of all the amateur satellites (the common ones first, frequencies known); tick one to
  put it in the radio, click one to see or edit it (an unticked one too: its edits go in with it). Select all the
  common ones; Update fetches the list and the orbits again; a search.
  卫星页简化：一张表列出所有业余卫星（常用的在前，频率已知）；勾选即加入电台，点击查看或编辑（未勾选的也能编辑，
  勾选时带上编辑的内容）。全选常用卫星；「更新」重新下载列表和轨道；搜索。
- Orbits come by themselves: when the page opens and again before writing, from AMSAT (through serve.py), else
  CelesTrak, else the TLE API. Old or missing orbits are named; reading a radio whose orbits are over 14 days old says so.
  轨道自动下载：打开页面时和写入前，依次从 AMSAT（经 serve.py）、CelesTrak、TLE API 获取；过期或缺少的会提示；
  读电台时如果电台里的轨道超过 14 天会提醒。
- 18 common satellites (AMSAT's FM list): ISS, SO-50, AO-91, AO-123, PO-101, IO-86, LilacSat, AO-27, SONATE-2,
  TEVEL2-1 to 9. The ISS preset fixed: its FM repeater is 145.990 up (67 Hz) / 437.800 down.
  18 颗常用卫星（AMSAT FM 卫星表）；修正 ISS：FM 中继上行 145.990（67 Hz）/ 下行 437.800。
- serve.py: serves the page and fetches AMSAT's orbit file for it (`py serve.py`).
  serve.py：本地启动页面，并替页面下载 AMSAT 的轨道文件。

## 0.2.0 (2026-11-10)

- Satellites: up to 25 (the radio's limit), with name, voice / APRS / other frequencies, CTCSS and arm tone, and the
  orbit (TLE). Presets for the FM satellites and the ISS; "Update orbits" fetches the TLEs from CelesTrak (one at a
  time, a failed one retried, the reason shown), or paste TLE text. Adding presets fetches their orbits; writing
  warns about satellites without one. Only the satellite block of the custom data is written.
  卫星：最多 25 颗（电台上限），名称、话音 / APRS / 其他频率、CTCSS 和激活亚音、轨道（TLE）。预设常用 FM 卫星和
  ISS；「更新轨道」从 CelesTrak 下载 TLE（逐颗下载，失败重试一次，显示原因），也可以粘贴 TLE。添加预设时自动下载
  轨道；写入前提醒没有轨道数据的卫星。只写自定义数据区里的卫星数据块。
- The radio's firmware version (status bar, General page).
  显示电台固件版本（状态栏、常规页）。

## 0.1.0 (2026-11-10)

First version. 第一个版本。

- Channels (FM, DMR, AM, USB, LSB), zones, contacts, TG lists, the two VFOs, callsign and DMR ID.
  信道（FM / DMR / AM / USB / LSB）、区域、联系人、TG 列表、两个 VFO、呼号和 DMR ID。
- The radio's own menu settings: general, radio, display, sound, APRS (OpenGD77 CPS can't edit them).
  电台菜单里的设置：通用、电台、显示、声音、APRS（OpenGD77 CPS 改不了这些）。
- Names in GB2312, as the radio shows them: Chinese names work.
  名称按 GB2312 写入，中文信道名正常显示。
- Read / write the radio over Web Serial (Chrome, Edge). A write changes only the codeplug's ranges (and the
  settings when they were edited), and only the 4 KB sectors that differ; the radio restarts to load it.
  通过 Web Serial 读写电台（Chrome / Edge）。写入只改码表部分（改过设置时也写设置），只写有变化的 4 KB 扇区，
  写完电台重启生效。
- Codeplug files of its own (`.opendmr`).
  自己的码表文件格式（`.opendmr`）。
- 中文 / English interface.
