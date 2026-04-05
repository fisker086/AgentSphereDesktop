# AgentSphere 桌面端

Tauri + React。需先安装 **Node.js**（建议 20+）、**Rust**（stable）；**macOS** 装 Xcode 命令行工具，**Windows** 装 MSVC 与 Windows SDK（及 WebView2，一般系统已有）。

**开发**

```bash
npm install
npm run tauri dev
```

**打包安装包**

在 **macOS 本机**打包得到 Mac 安装包，在 **Windows 本机**打包得到 Windows 安装包。Rust 虽可交叉编译，但 Tauri 依赖各系统 WebView 与原生链接，交叉编译配置很重，官方也不作为常规路径；双平台一般用 **两台机器分别打** 或 **CI（如 GitHub Actions 的 macOS / Windows runner）各跑一遍 `npm run tauri build`**。

```bash
npm install
npm run tauri build
```

完成后在 `src-tauri/target/release/bundle/` 下找 `.dmg` / `.app`（Mac）或 `.msi` / 安装程序（Windows）。

使用应用前请启动 AgentSphere 后端；默认连接 `http://localhost:8080`，可在登录或配置里改地址。

**CI**：`.github/workflows/tauri-desktop.yml`。GitHub 只认**仓库根**的 `.github`；monorepo 需拷到根目录或单独建库。推送 **`v*` 标签**（如 `git tag v0.1.0 && git push origin v0.1.0`）会在 **Releases** 自动生成带安装包的 Release；普通 push 只在 Actions 里保留 Artifact（有过期时间）。


## 本项目暂时只是桌面客户端, 需要配合服务端一起工作
