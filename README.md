# OpenDMR CPS

[English](README.en.md) · 浏览器里的写频软件，用于运行 [OpenDMR](https://github.com/va3bpf/OpenDMR) 固件的
**Baofeng DM-32 / DM-32UV**。

当前版本 **0.4.0**（[版本记录](CHANGELOG.md)）

## 功能

- 信道（FM / DMR / P25 / AM / USB / LSB；P25 的 NAC）、区域、联系人、TG 列表、VFO A / B、呼号和 DMR ID
- 电台菜单里的设置（通用、电台、显示、声音、APRS），功率 50 mW – 10 W，每个信道和 VFO 各自的功率
- 业余卫星：勾选即加入电台，轨道自动下载（AMSAT / CelesTrak）
- DMR ID 数据库：下载（ContactLists）或导入 CSV（如 radioid.net 的 user.csv），按国家筛选，写入电台后收到呼叫时显示呼号和名字
- 中文名称按 GB2312 写入，电台上正常显示
- 用写频线直接读写电台；只写有改动的部分，电台自己的其他设置不会被覆盖
- 码表文件保存 / 打开
- 中文 / English 界面，深色模式

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
