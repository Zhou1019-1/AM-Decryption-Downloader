# 章鱼AM解密工具（AM Decryption Downloader）

> Apple Music 音乐下载解密工具的 Windows 桌面客户端。自研 UI + 完整本地化下载解密链路，支持 ALAC 无损 / AAC / 杜比全景声，内嵌完整元数据标签，可选自动转 FLAC。

## 功能特性

- **链接解析**：支持 Apple Music 歌曲 / 专辑 / 歌单链接（含无 slug 短链）
- **全编码覆盖**：ALAC 无损（最高 24bit/192kHz）、AAC 256K、HE-AAC、杜比全景声（EC-3）
- **本地解密**：FairPlay 解密在本地完成（temari.wasm），密钥模板由 wrapper-lite 密钥服务下发，raw key 不出后端
- **完整标签**：标题 / 艺术家 / 专辑 / 专辑艺术家 / 作曲家 / 流派 / 年份 / 曲目号 / 碟号 / 歌词 / 封面 / ISRC / 版权 / 厂牌 / UPC / 分级 / 歌曲·专辑·艺术家 ID / 排序字段
- **歌词**：TTML → LRC，支持翻译行、发音（罗马音/拼音）行
- **ALAC 修复**：自动修复 Apple 封装的 END-tag 缺陷（escape frame 结束标记丢失问题）
- **转 FLAC**：ALAC 下载后可自动无损转 FLAC（ffmpeg），可选保留原 m4a
- **重封装**：fMP4 → 标准 MP4，foobar2000 等老播放器直接兼容
- **去公益化双保险**：密钥服务本地 wrapper-lite 优先、远程公共服务兜底；元数据/搜索官方 amp-api 直连（developer token 自抓）、公益代理兜底

## 安装与使用

### 快速开始（整合包）

从 [Releases](../../releases) 下载 **整合包 zip**，解压后：

1. 安装 `章鱼AM解密工具-章鱼科技版-Setup.exe`
2. 双击 `0-一键部署密钥服务.bat`（部署 wrapper-lite 到 `C:\wrapper-lite`）
3. 首次运行 `1-login.bat` 登录 Apple ID（**强烈建议使用小号**，登录态缓存后无需重登）
4. 运行 `2-start-server.bat` 启动本地密钥服务（保持窗口开启）
5. 打开软件 → 设置 → 密钥服务地址填 `http://127.0.0.1:12340`，API Key 留空
6. 粘贴 Apple Music 链接，开下

详细教程见 [docs/章鱼AM解密工具-整合包使用教程.docx](docs/章鱼AM解密工具-整合包使用教程.docx)。

### 从源码构建

```bash
npm install
# 需要将一个 ffmpeg.exe（Windows x64）放到项目根目录（用于转 FLAC）
npm start                 # 开发运行
npx electron-builder --win --x64   # 打包 NSIS 安装包
```

## 技术架构

```
Apple Music 链接
  → catalog 元数据（官方 amp-api 直连 / 公益代理兜底）
  → wrapper-lite 密钥服务（本地 QEMU 虚拟客户端优先 / 远程公共服务兜底）
  → Apple CDN 拉取 HLS fMP4 分片（Range 直取）
  → temari.wasm 本地逐样本解密
  → fMP4 重封装为标准 MP4 + ilst 标签/封面/歌词写入
  → ALAC END-tag 修复 → 可选 ffmpeg 转 FLAC
```

核心模块：

| 文件 | 职责 |
|---|---|
| `downloader.js` | 链接解析 / catalog / m3u8 / 分片下载 / 解密调度 / 歌词 / 封面（零 npm 依赖） |
| `temari.wasm` | FairPlay 解密核心（Rust 编译） |
| `remux.js` | fMP4 → 标准 MP4 重封装 |
| `mp4tag.js` | 自研 MP4 ilst 元数据写入 |
| `alacfix.js` | ALAC END-tag 修复 |
| `service.js` | 本地 HTTP 播放服务（供第三方播放器集成，支持 Range） |

## 致谢

本项目站在这些优秀项目的肩膀上：

- **[WorldObservationLog/wrapper](https://github.com/WorldObservationLog/wrapper)**（wrapper-lite）：本地密钥服务的核心，虚拟苹果客户端环境完成 FairPlay 密钥协商
- **[amd.wol.moe](https://amd.wol.moe/)**：本工具的行为参照系——下载解密流程、ALAC 修复、歌词附加内容等均复刻自该站的前端实现
- **temari**：FairPlay 解密 WASM 库
- **[itouakirai/am-hook](https://github.com/itouakirai/am-hook)**：功能设计参考（ALAC 体检、AAC-LC 兜底等思路来源，协议为 AGPL 故未使用其代码）
- **[gamdl](https://github.com/glomatico/gamdl)**：Apple Music 下载领域的先驱参考
- **Electron / FFmpeg**：应用框架与转码工具

## 免责声明

本项目仅供学习与技术研究使用。下载的音乐文件版权归唱片公司与 Apple Inc. 所有，请在个人合法订阅范围内使用，不得用于商业用途或传播。使用本工具产生的任何法律后果由使用者自行承担。请在了解风险的前提下使用自己的 Apple ID（建议小号）。

## License

MIT（`temari.wasm` 等第三方组件遵循其各自许可证）
