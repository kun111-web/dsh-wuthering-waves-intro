# 鸣潮入场动画

为 DeepSeek Harness（DSH）桌面端提供 20 个角色的静音开场动画，含线稿入场、完整播放、快速开场和粒子退场。视频为 3840×1488、60 帧/秒。

![守岸人动画预览](assets/characters/shorekeeper.webp)

当前版本 **0.4.9**。插件声明支持 DSH `>=0.2.2-rc.1 <0.3.0-0`。仓库安装和手动升级流程已在 DSH `0.2.2-rc.3` 验证。

## 安装与升级

在 DSH「插件 → 添加插件」的顶部输入框粘贴固定仓库地址，安装后启用插件。

```text
https://github.com/kun111-web/dsh-wuthering-waves-intro
```

升级时，从托盘完全退出 DSH，再用桌面端提供的 `dsh` 命令重新安装同一个地址，然后打开 DSH。每次安装会锁定当时 `main` 分支的提交。

```powershell
dsh plugin --profile desktop add 'https://github.com/kun111-web/dsh-wuthering-waves-intro'
```

离线安装时，先下载约 288 MiB 的 `dsh-wuthering-waves-intro-0.4.9.tgz`，再把完整文件路径填入「添加插件」。安装包内含全部素材，校验值见同页的 `SHA256SUMS.txt`。[最新安装包](https://github.com/kun111-web/dsh-wuthering-waves-intro/releases/latest)

## 使用

在「设置 → 鸣潮入场动画」选择角色和播放模式，也可预览或关闭启动播放。播放中点击画面或按 Esc 可跳过。动画从本地读取，偏好保存在 DSH 的 WebView。

## 素材与打包

20 个 H.264 视频和预览图位于 `assets/characters/`，角色和片段信息见 `src/characters.json`。重新制作素材时，先用 FFmpeg 与 FFprobe 执行 `npm run split -- '<源视频完整路径>'`，再用配置了 OpenCV 和 NumPy 的 Python 环境执行 `npm run trace`。

运行 `npm run pack:plugin` 生成版本化 `.tgz` 和 SHA-256 记录。打包检查版本、运行入口和全部素材。GitHub Releases 公开保留最新安装包，历史版本可通过 Git 标签查看。

## 许可

插件原创代码采用 Apache-2.0。鸣潮角色、视频、预览图及衍生线稿归库洛游戏和相关权利人所有。线稿入场和粒子退场的构思参考了 SoliSpark 的守岸人主题。[代码许可证](LICENSE) · [素材与署名](NOTICE.md)
