# OpenDMR CPS

[English](README.en.md) · 浏览器里的写频软件，用于运行 [OpenDMR](https://github.com/va3bpf/OpenDMR) 固件的
**Baofeng DM-32 / DM-32UV**。

当前版本 **0.7.1**（[版本记录](CHANGELOG.md)）

## 功能

- 信道（FM / DMR / P25 / AM / USB / LSB；P25 的 NAC）、区域、联系人、TG 列表、APRS 配置、VFO A / B、呼号和 DMR ID
- 电台菜单里的设置（通用、电台、显示、声音、APRS），功率 50 mW – 10 W，每个信道和 VFO 各自的功率
- APRS：配置页有 94 个符号的下拉列表（主表 / 副表）
- 业余卫星：勾选即加入电台，轨道自动下载（AMSAT / CelesTrak）
- DMR ID 数据库：导入 CSV（如 radioid.net 的 user.csv，点一下就能下载），按国家筛选，写入电台后收到呼叫时显示呼号、名字、城市、州/省和国家（OpenDMR 0.4.0 及以后；全部 ID 都存得下，只写变了的部分）
- 中文名称按 GB2312 写入，电台上正常显示
- 用写频线直接读写电台；只写有改动的部分，电台自己的其他设置不会被覆盖
- 码表文件保存 / 打开
- CSV 导入 / 导出，格式和 OpenGD77 CPS 一样（信道、区域、联系人、TG 列表、APRS），可以直接导入 OpenGD77 的 CSV，也可以把别的软件的信道表改成这个格式导入（[说明](docs/csv.md)）
- 电台主题：新建自己的配色、给自带主题改色或隐藏，在电台自己的屏幕上预览（OpenDMR 0.6.0 及以后）
- 中文 / English / Español 界面，深色模式

## 刷写与备份

侧栏下面的 **刷写与备份**（Flasher）页：

- **更新固件**：选 `opendmr.bin`，通过写频线写进去，不用 PTT + SK1 升级模式。只写固件区（0xC000 以上），
  引导程序和出厂校准不动；每个扇区先比 CRC，只写不同的，写完再读回校验。和 `tools/debug/fw_update.py` 同一套协议。
- **三份备份**：码表和设置（电台开机，几秒）、程序 Flash（1 MB：固件和引导程序）、数据 Flash（16 MB：码表、设置、
  卫星，以及出厂校准的那个扇区）。后两份走芯片引导程序：电台先关机，页面等它开机时握手。
- **写回备份**：只写和电台不同的扇区，写完全部校验；写程序 Flash 时 0xC000 以下的引导程序不动。

刷写时页面顶部会显示在做什么、做到哪一步；电台自己的屏幕也显示同样的内容（标题、「不要断电」、百分比）。
页面按三步排：**1 先做备份**、**2 安装或更新**、**3 退回原厂固件**；下面还有 **记录** 卡，能存成文件。
写有三条路：**更新**（只写不同的扇区）、**安装 / 全部重写**（固件区全写）、以及 **引导程序**（电台关机再开机）：
把 OpenDMR 装到原厂固件的电台（`opendmr.bin`，从 0xC000 写），或者恢复出厂（用这台电台自己的程序 Flash 备份，可加数据 Flash）。
恢复出厂的按钮会检查拿到的是不是对应的文件。

电台端用的两个程序在 `assets/` 里（`updater.bin`、`dumper.bin`），从文件夹（`py serve.py`）打开时读的是这两个文件；
从磁盘双击打开 `opendmr-cps.html` 时用页面里内置的同一份副本（`file://` 不许读文件）。重建它们之后跑一次
`py tools/web/embed_bin.py`：`assets/` 和内置副本一起更新。

要一个可以直接上传的文件夹版本：`py tools/web/make_folder.py` 生成 `dist/web/`（页面源码 + `js/` + `assets/` +
`firmware/` + `serve.py`），放进任何 HTTP 服务器即可；页面自己读 `firmware/index.json`，不用选文件。

要发给不太懂电脑的人：`py tools/web/make_package.py` 生成 `dist/paquete/OpenDMR-CPS/`（`Abrir CPS.bat`、
`opendmr-cps.html`、`programas/` 里的两个 bin、排版好的 `LEEME-PRIMERO.html` 和纯文本版）和同名 zip：
解压，双击 `Abrir CPS.bat` 就行，不用装任何东西。

## 使用

1. 用 **Chrome 或 Edge** 打开（需要 Web Serial），两种方式任选：
   - 从 [Releases](../../releases) 下载 **`opendmr-cps.html`**（或用本仓库里的），双击打开，不用装任何东西。卫星轨道从
     CelesTrak / TLE API 下载
   - 双击 `start.bat`（或运行 `py serve.py`），打开 `http://localhost:8000`。这样还能从 AMSAT 下载卫星轨道
2. 电台开机、插上写频线，点「连接电台」，选择写频线的串口
3. 「从电台读取」→ 编辑 →「写入电台」，电台写完自动重启

写入前建议先「保存文件」备份。

## 许可

见 [LICENSE](LICENSE)：可以自由使用和修改，**仅限非商业用途**。

## 开发

`index.html`、`css/`、`js/` 是源码，通过 serve.py 打开即可调试（浏览器不从磁盘上的文件加载 JS 模块）。

- `py release.py`：生成发行用的 `opendmr-cps.html`（代码合成一个文件，压缩到最小）。改完源码后运行。
  需要先安装：`py -m pip install rjsmin rcssmin minify-html zopfli`
- `py build.py`：生成可读的 `opendmr-cps-debug.html`，用于调试从磁盘直接打开的情况
- `py tools/web/make_folder.py`：生成 `dist/web/`，作为网站用文件夹发布（页面模块 + `assets/`）；
  `py tools/web/embed_bin.py`：把 `tools/debug/updater/updater.bin` 和 `tools/backup/dumper/dumper.bin`
  复制到 `assets/` 并重新生成内置副本
- 测试（不用电台）：`node tools/web/tests/test-updater.mjs`、`test-bootloader.mjs`、`test-assets.mjs`，
  以及 `py build.py && node tools/web/tests/test-page.mjs`（需要 jsdom）
