# Changelog / 版本记录

## 0.12.0 (2026-11-22)

- Themes: Export theme saves the chosen theme (name, light or dark, colours) to a JSON file; Import themes adds such
  files as your own themes, to share them
  ([OpenDMR #117](https://github.com/va3bpf/OpenDMR/issues/117)).
  主题：“导出主题”把选中的主题（名字、亮色或暗色、颜色）存成 JSON 文件；“导入主题”把这种文件加成自己的主题，方便分享
  （[OpenDMR #117](https://github.com/va3bpf/OpenDMR/issues/117)）。
- "No room for the themes in the custom data" with plenty of room: the radio's custom data area held invalid data
  where a free place should be (zeros), and nothing could be added after it. Only when a change needs a new block
  there, the CPS now asks whether to clear the invalid part (the valid blocks before it are kept); once written, it
  doesn't ask again. A block of another length is no longer resized in place over the blocks after it
  ([OpenDMR #124](https://github.com/va3bpf/OpenDMR/issues/124); also "no room for the NXDN ID", #16).
  空间明明够却提示“no room for the themes in the custom data”：电台的自定义数据区里本该是空位的地方是无效数据（全 0），后面什么
  都加不进去。现在只有在这次修改确实要新增数据块时，CPS 才会询问是否清除这部分无效数据（前面有效的块都保留）；写入一次以后就不
  会再问。长度不同的同类数据块也不再原地改长度、覆盖后面的块（[OpenDMR #124](https://github.com/va3bpf/OpenDMR/issues/124)；
  “no room for the NXDN ID” 也是这个原因，#16）。
- Cable speed (toolbar, before Connect): “Auto speed” ticked as before (the fastest the cable keeps for the long writes, slower
  when sectors fail), or, unticked, the speed typed in the box (115200 ... 1312500, the radio’s nearest) used for every read and write, the codeplug too; an
  error says when the cable does not keep it. Kept in the browser. After a failed write the next try waits for the
  radio to drop the request cut short ([OpenDMR #125](https://github.com/va3bpf/OpenDMR/issues/125)).
  数据线速率（工具栏“连接电台”前面）：勾选“自动速率”（和以前一样，大量写入时用数据线能稳定工作的最快速率，扇区出错就降速），或者不勾选、在框里
  填一个速率（115200 ~ 1312500，取电台最接近的速率），所有读写（包括码表）都用它；数据线不支持时会报错。设置保存在浏览器里。写入失败后先等电台丢掉被截断
  的请求再重试（[OpenDMR #125](https://github.com/va3bpf/OpenDMR/issues/125)）。

## 0.11.1 (2026-11-21)

- Languages page: the languages and the Chinese font come from
  [opendmr-languages](https://github.com/va3bpf/opendmr-languages) now (OpenDMR 0.8.1 no longer has a languages
  folder in its zip): download it, choose its languages folder; the languages found are ticked.
  语言页：语言和中文字库改从 [opendmr-languages](https://github.com/va3bpf/opendmr-languages) 下载（OpenDMR 0.8.1 的压缩包
  里不再有 languages 文件夹）：下载后选它的 languages 文件夹，找到的语言默认勾选。

## 0.11.0 (2026-11-21)

- Boot screen image (General page): choose a picture, it becomes the radio's 240 x 320 power-on screen in 16
  colours (custom data block type 1), or take the preset; shown when Radio settings -> Boot screen is on. Needs
  OpenDMR 0.8.0 ([#14](https://github.com/va3bpf/opendmr-cps/pull/14), by vargasmiguel).
  开机画面图片（“常规”页）：选一张图片，转换成电台 240 x 320、16 色的开机画面（自定义数据块类型 1），也可以用预设图案；
  在“电台设置 → 开机画面”打开后显示。需要 OpenDMR 0.8.0。
- Languages page: the radio's interface languages are files now (OpenDMR 0.8.0: the firmware has English only).
  Choose the languages folder of the OpenDMR zip: Chinese and Spanish are ticked, Write puts them in the radio with
  the font Chinese needs (cjk.bin, about 2 minutes); what the radio has already is not written again. A language
  whose font is neither in the radio nor chosen is pointed out (the radio would show "??"). Languages and fonts in
  the radio are listed and can be deleted. Radio settings: the language list is English and the radio's languages
  (custom data "DT" 8, the language code).
  语言页：电台界面语言现在是文件（OpenDMR 0.8.0：固件只带英文）。选择 OpenDMR 压缩包里的 languages 文件夹，中文和西班牙文
  默认勾选，点“写入电台”就连同中文要用的字库（cjk.bin，约 2 分钟）一起写进电台；电台里已有的不重写。需要字库、而电台里没有也
  没选到字库的语言会提醒（否则电台显示“??”）。可以查看和删除电台里的语言和字库。电台设置：语言列表是英文加电台里的语言
  （自定义数据 “DT” 8，存语言代码）。

## 0.10.0 (2026-11-20)

- M17 channels (firmware with M17, opendmr_mode 0xA6): the mode in the channel and VFO editors, the CSV files
  (Channel Type `M17`); a channel's CAN (0 - 15, column `CAN`). M17 transmits to ALL from the callsign under General.
  Before, an M17 channel read into the CPS and written back became a DMR channel.
  M17 信道（带 M17 的固件，opendmr_mode 0xA6）：信道和 VFO 编辑、CSV（Channel Type `M17`）都可以选；信道的 CAN（0 - 15，
  `CAN` 列）。M17 发射的目的是广播 ALL，源呼号是“常规”里的呼号。以前 M17 信道经 CPS 读写一次会变成 DMR 信道。
- DMR ID database: a sector write that fails is retried at lower cable speeds, and the speed in use is shown while
  writing ([#9](https://github.com/va3bpf/opendmr-cps/pull/9), [#10](https://github.com/va3bpf/opendmr-cps/pull/10)).
  DMR ID 数据库：某个扇区写入失败时自动降低写频线速度重试，写入时显示当前速度。

## 0.9.0 (2026-11-19)

- Themes page: make your own colour themes for the radio (up to 8), recolour a built-in theme or hide it from the
  radio's menu, previewed on the radio's own screens (home, menu, display options, quick menu, FM radio), with a
  warning for colour pairs that may be hard to read. Needs OpenDMR 0.6.0.
  主题页：给电台新建自己的配色（最多 8 个），给自带主题改色或在电台菜单里隐藏，在电台自己的屏幕上（主界面、菜单、显示设置、快捷菜单、
  收音机）预览；对比度太低的颜色会提示。需要 OpenDMR 0.6.0。
- Spanish interface, and the radio's menu language (English, Chinese, Spanish) in the radio settings; thanks to
  vargasmiguel ([#7](https://github.com/va3bpf/opendmr-cps/pull/7)).
  西班牙语界面，电台设置里可以选电台菜单的语言（英文、中文、西班牙语）；感谢 vargasmiguel。

## 0.8.3 (2026-11-18)

- Channels and contacts: delete many at once. Tick them (the box in the header ticks all those the filter shows),
  then "Delete ticked"; deleted channels leave their zones, deleted contacts their TG lists and channels, as one by
  one ([#1](https://github.com/va3bpf/opendmr-cps/issues/1)).
  信道和联系人可以批量删除：勾选（表头的勾选框全选筛选后显示的这些），再点「删除选中」；和逐个删除一样，删掉的信道会从区域里去掉，
  删掉的联系人会从接收组和信道里去掉。

## 0.8.2 (2026-11-18)

- Satellites: the common satellites are now your own list. Add a satellite to it or update it with its frequencies
  (and its TLE when no orbit file has it, e.g. a new satellite with a temporary number), remove one, make a new
  satellite, export the list as a file to share and import one; "Back to the CPS list" undoes it. The list is kept in
  the browser.
  卫星：常用卫星可以改成你自己的列表。把一颗卫星连同它的频率存到常用或更新（轨道文件里没有的卫星，比如刚发射、只有临时编号的，
  连它的 TLE 一起存），从常用移除，新建卫星，把列表导出成文件分享、导入别人的列表；「恢复自带列表」回到 CPS 的。列表存在浏览器里。

## 0.8.1 (2026-11-18)

- DMR IDs: the ContactLists list on GitHub the CPS downloaded is gone (404). The button now downloads radioid.net's
  user.csv (some 17 MB) in the browser, to be opened with "Open a CSV file": radioid.net lets no page read it
  directly. "Download and write" is gone with it ([#5](https://github.com/va3bpf/opendmr-cps/issues/5)).
  DMR ID：CPS 原来下载的 GitHub 上的 ContactLists 列表已经没有了（404）。按钮改成在浏览器里下载 radioid.net 的 user.csv
  （约 17 MB），再用「打开 CSV 文件」打开：radioid.net 不允许网页直接读取。「下载并写入」也随之去掉。
- Channels and CSV import: the airband (108 - 136.9975 MHz, receive only, OpenDMR 0.4.0 and later) is accepted
  ([#3](https://github.com/va3bpf/opendmr-cps/issues/3)).
  信道和 CSV 导入：接受航空频段（108 - 136.9975 MHz，只收，OpenDMR 0.4.0 及以后）。

## 0.8.0 (2026-11-17)

- NXDN channels (firmware with NXDN, opendmr_mode 0xA5): the mode in the channel and VFO editors, the CSV files
  (Channel Type `NXDN`); a channel's RAN (0 - 63, 0: receive any), its contact and TG list.
  NXDN 信道（带 NXDN 的固件，opendmr_mode 0xA5）：信道和 VFO 编辑、CSV（Channel Type `NXDN`）都可以选；信道的 RAN（0 - 63，0
  收全部），以及它的联系人和接收组。
- General: the radio's NXDN ID (1 - 65535, a custom data block "DT" 6); empty: the DMR ID.
  常规：电台的 NXDN ID（1 - 65535，存在自定义数据块 "DT" 6）；留空用 DMR ID。
- Debug page: the radio's receive log (a test firmware with the receive log, e.g. 0.4.1-debug; not in the released
  firmware yet): turn it on or off, see its state, export it as one .rxlog file (only what was recorded: no empty
  flash) to send for an analysis of lost DMR frames, clear it.
  调试页：电台的接收记录（需要带接收记录的测试版固件，如 0.4.1-debug；正式版固件还没有）：开 / 关记录、看状态、导出成一个
  .rxlog 文件（只导出有记录的部分，空白的 flash 不导出）发给开发者分析 DMR 丢帧、清空记录。
- The old-format DMR ID database (for a firmware before 0.4.0) ends below the receive log area (4 MB in the window).
  旧格式的 DMR ID 库（0.4.0 以前的固件用）写到接收记录区之前为止（窗口内 4 MB）。

## 0.7.0 (2026-11-16)

- CSV import / export in the OpenGD77 CPS's format (its File > CSV: Channels.csv, Zones.csv, Contacts.csv,
  TG_Lists.csv, APRS.csv, the same columns and values), so its files import as they are and a channel list from another
  CPS can be edited into them; OpenDMR's settings in columns added at the end (NAC, Step, Force DMO) and Channel Type
  values AM, USB, LSB, P25. Export: one zip of the files; import: the zip or any of the CSV files (UTF-8 or GBK, comma,
  semicolon or tab), Replace or Append as in the OpenGD77 CPS, references by name, nothing changed on an error (each
  listed with its line) (docs/csv.en.md).
  CSV 导入 / 导出，格式和 OpenGD77 CPS 的 File > CSV 一样（Channels.csv、Zones.csv、Contacts.csv、TG_Lists.csv、APRS.csv，
  列和取值都相同）：OpenGD77 的文件可以直接导入，别的软件的信道表改成这个格式也能导入；OpenDMR 多的设置放在最后几列（NAC、步进、
  强制直通），Channel Type 多了 AM、USB、LSB、P25。导出是一个 zip；导入可以选 zip 或任意几个 CSV（UTF-8 或 GBK，逗号、分号或
  Tab 分隔），和 OpenGD77 一样分「替换」「追加」，引用按名称，有错误时什么都不改并列出每个错误的行号（docs/csv.md）。
- APRS page: the 8 APRS configurations (name, SSID, path, icon, comment, fixed position and ambiguity, beacon Tx
  frequency, Transmit QSY, 300 / 1200 baud); a channel's APRS configuration, place and talker alias Tx in its editor.
  A "?" after an item shows its help in a bubble.
  APRS 页面：8 组 APRS 配置（名称、SSID、路径、图标、注释、固定位置和位置模糊、信标发射频率、发送 QSY、300 / 1200 波特）；信道编辑里
  可以选 APRS 配置、填位置、设 Talker Alias 发送。各项后面的「?」点开是说明气泡。
- Scan lockouts page: the VFO frequencies locked out of the scans for good, and the channels with a scan skip flag.
  扫描锁定页面：永久跳过扫描的 VFO 频率，以及设了扫描跳过的信道。
- Faster cable: the codeplug is read packed (firmware 0.4.0 and later; 188 KB in about 1 s instead of 17 - 19 s),
  only the changed sectors are read back before a write, and the cable speed is found in about half a second (the
  speed of each kind of cable remembered).
  写频线更快：码表打包读取（0.4.0 及以后的固件；188 KB 约 1 秒，原来 17 - 19 秒），写入前只回读变了的扇区，写频线速率约半秒就能
  确定（每种写频线的速率会记住）。

## 0.6.0 (2026-11-15)

- DMR IDs in OpenDMR's own format (firmware 0.4.0 and later): callsign, name, city, state and country of every ID,
  RadioID's whole list in about 3.5 MB (the same bytes as the firmware's tools/ids/id_db.py). From ContactLists the
  first name is kept and the country code becomes its name. The cable goes up to 750000 baud while it writes, each
  sector's CRC is compared first and only the changed ones are written: about 3 minutes the first time, some seconds
  when little changed. A radio with an older firmware still gets the OpenGD77 format (16 characters, its CPS's
  defaults); the characters and city options are gone from the page.
  DMR ID 数据库改用 OpenDMR 自己的格式（固件 0.4.0 及以后）：每个 ID 的呼号、名字、城市、州/省和国家，RadioID 的全部名单约
  3.5 MB（和固件的 tools/ids/id_db.py 生成的完全相同）。ContactLists 的名字只留名，国家代码换成国家名。写入时写频线提速到
  750000 波特，先比较每个扇区的 CRC，只写变了的：第一次约 3 分钟，变动少时几秒钟。旧固件的电台仍写 OpenGD77 格式（每条 16 个
  字符，和它的 CPS 默认一样）；页面上不再有字符数和城市选项。

## 0.5.0 (2026-11-13)

- DMR IDs: the radio shows a DMR caller's callsign and name from this database. Download the list the OpenGD77 CPS
  uses (ContactLists on GitHub) or open a CSV (that one, or radioid.net's user.csv); keep only the IDs of some
  countries (their prefixes), 8 to 31 characters each (all the radio shows), the city if wanted;
  the page shows how many fit, the size and the write time, and the text as the radio shows it. Written as the
  OpenGD77 CPS writes it (the same bytes, at 0x50000 and 0xD8000); needs an OpenDMR firmware after 0.3.1, which finds
  it there. Not part of the codeplug file.
  DMR ID 数据库：电台收到 DMR 呼叫时用它显示对方的呼号和名字。可以下载 OpenGD77 CPS 用的列表（GitHub 上的
  ContactLists），也可以打开 CSV 文件（这个列表，或 radioid.net 的 user.csv）；
  可以只保留某些国家的 ID（按开头的国家代码），每条 8 到 31 个字符（电台最多显示这么多），可加城市；页面显示能存多少条、大小、写入时间，
  以及在电台上的显示效果。写法和 OpenGD77 CPS 完全一样（同样的字节，写在 0x50000 和 0xD8000）；需要 OpenDMR
  0.3.1 之后的固件才能读到。不包含在码表文件里。

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
