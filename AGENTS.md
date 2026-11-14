# 鸣潮入场动画发版规则

GitHub Releases 只保留本插件的最新版。

1. 发布新版 Release 后，先从公开下载地址下载 `.tgz` 和 `SHA256SUMS.txt`，核对安装包的 SHA-256 与校验记录一致。
2. 新版下载和校验通过后，删除本仓库的旧 Release，保留所有历史 Git 标签。使用 `gh release delete` 时省略 `--cleanup-tag`。
3. 清理后核对 Releases 列表仅有最新版，并确认历史 Git 标签仍可查阅。
