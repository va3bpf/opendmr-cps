# OpenDMR CPS

浏览器里的写频软件，用于运行 [OpenDMR](https://github.com/va3bpf/OpenDMR) 固件的 **Baofeng DM-32 / DM-32UV**。
A codeplug editor in the browser for the Baofeng DM-32 / DM-32UV running OpenDMR. English below.

当前版本 **0.4.0**（[版本记录](CHANGELOG.md)）

## 功能

- 信道（FM / DMR / P25 / AM / USB / LSB；P25 的 NAC）、区域、联系人、TG 列表、VFO A / B、呼号和 DMR ID
- 电台菜单里的设置（通用、电台、显示、声音、APRS）
- 业余卫星：勾选即加入电台，轨道自动下载（AMSAT / CelesTrak）
- 中文名称按 GB2312 写入，电台上正常显示
- 用写频线直接读写电台；只写有改动的部分，电台自己的其他设置不会被覆盖
- 码表文件保存 / 打开
- 中文 / English 界面，深色模式

## 使用

1. 用 **Chrome 或 Edge** 打开（需要 Web Serial），两种方式任选：
   - 从 [Releases](../../releases) 下载 **`opendmr-cps.html`**（或用本仓库里的），双击打开，不用装任何东西。卫星轨道从 CelesTrak / TLE API 下载
   - 双击 `start.bat`（或运行 `py serve.py`），打开 `http://localhost:8000`。这样还能从 AMSAT 下载卫星轨道
2. 电台开机、插上写频线，点「连接电台」，选择写频线的串口
3. 「从电台读取」→ 编辑 →「写入电台」，电台写完自动重启

写入前建议先「保存文件」备份。

---

## English

Current version **0.4.0** ([changelog](CHANGELOG.md)).

- Channels (FM / DMR / P25 / AM / USB / LSB; the NAC of P25), zones, contacts, TG lists, VFO A / B, callsign and DMR ID
- The radio's menu settings (general, radio, display, sound, APRS)
- Amateur satellites: tick to put in the radio, orbits fetched by themselves (AMSAT / CelesTrak)
- Names in GB2312, so Chinese names show on the radio
- Reads and writes the radio over the programming cable; a write changes only what was edited
- Codeplug files; 中文 / English interface; dark mode

In Chrome or Edge (Web Serial), double-click **`opendmr-cps.html`** (from [Releases](../../releases), or this repository): nothing to install. Or double-click `start.bat`
(or run `py serve.py`) and open `http://localhost:8000`: serve.py also fetches AMSAT's satellite orbits. Connect, read the
radio, edit, write; the radio restarts to load the codeplug. Save a file first as a backup.

## Licence

See [LICENSE](LICENSE): free to use and change, **non-commercial use only**.

## 开发 / Development

`index.html`、`css/`、`js/` 是源码，通过 serve.py 打开即可调试。

- `py release.py`：生成发行用的 `opendmr-cps.html`（代码合成一个文件，压缩到最小）。改完源码后运行。
  需要先安装：`py -m pip install rjsmin rcssmin minify-html zopfli`
- `py build.py`：生成可读的 `opendmr-cps-debug.html`，用于调试从磁盘直接打开的情况

The sources are `index.html`, `css/` and `js/` (served by serve.py). `py release.py` makes the release page
`opendmr-cps.html`: everything in one file, as small as it gets (needs `py -m pip install rjsmin rcssmin minify-html
zopfli`); browsers do not load JS modules from a file on disk. `py build.py` makes a readable `opendmr-cps-debug.html`.
