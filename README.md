# Cloudflare Workers 记事本

📒 简单笔记本，支持多语言文件名、移动端适配和自动/手动保存
一个基于 **Cloudflare Workers + KV** 搭建的极简记事本应用，支持多语言文件名、自动保存、目录浏览、时间戳记录，并且对移动端优化。

---

## ✨ 功能特点

- 🌍 **支持多语言文件名**  
  直接通过 `/你好`、`/メモ`、`/записка` 等路径访问笔记。  

- 📝 **在线编辑 & 自动保存**  
  页面提供编辑框，点击保存即可写入 KV。
  - 自动保存（每 5 秒一次，无提示）
  - 手动保存按钮（点击显示“已保存”提示）

- 📂 **目录浏览**  
  首页自动列出所有笔记，显示文件名、创建时间和更新时间。
  - 目录页显示创建时间与最后更新时间（浏览器本地时间）

- ⏰ **时间戳记录**  
  每个笔记保存 `created_at` 和 `updated_at`，便于追踪笔记历史。  

- 📱 **移动端适配**  
  字体更大，间距合理，按钮易于点击。
  - 安卓/iOS 系统图标不会生成目录项

- 🔍 **原始内容输出**  
  在 URL 后加 `?raw` 可返回纯文本内容，方便 curl/wget 或其他工具读取。  

---

## 🚀 部署方法

### 1. 创建 KV Namespace
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)  
2. 进入 **Workers & Pages → KV → Create namespace**  
3. 命名为 `notes_kv_example`（或者任意名称）  
> ⚠️ `notes_kv_example` 是示例名称，你可以创建自己的 KV 并绑定到 `NOTES_KV`。
### 2. 创建 Worker
1. 进入 **Workers & Pages → Create Application → Create Worker**  
2. 将仓库中的 `worker.js` 代码粘贴到编辑器中  
3. 在 **Settings → Variables and Bindings → KV Namespace Bindings** 添加绑定：  
   - **Variable name**: `NOTES_KV`  
   - **Namespace**: 选择刚刚创建的 KV 
   - **可选环境变量**（用于密码保护）：
   - `FIXED_PASSWORD`：全局固定密码（推荐设置）
      在 Cloudflare Dashboard → Workers → 你的 Worker → Settings → Variables → Secrets
      添加一个 Secret，名称为 FIXED_PASSWORD，值就是你的密码。

### 3. 保存并部署
点击 **Save and Deploy**，Cloudflare 会为你分配一个测试域名，例如：  
https://your-worker.your-subdomain.workers.dev

## 📖 使用说明
- 访问根目录 `/` 查看笔记列表  
- 访问 `/你好` 创建或编辑笔记  
- 访问 `/你好?raw` 以纯文本方式输出内容
- 
- **访问笔记**：直接在 URL 后输入笔记名称，例如：
  - `https://your-worker.workers.dev/我的笔记`
  - `https://your-worker.workers.dev/random5char`（随机生成）

- **密码保护**：
  1. 在编辑页面勾选「密码保护」
  2. 保存后，该笔记会被加密
  3. 再次访问时需要输入 `FIXED_PASSWORD` 才能查看/编辑

- **删除笔记**：在编辑页面清空所有内容并保存，即可删除该笔记。
---

## 🛠️ 本地开发（可选）

1. 安装 Wrangler：npm install -g wrangler
2. 登录：wrangler login
3. 初始化项目：wrangler init notes-worker
4. 将 `worker.js` 覆盖到项目文件夹中，编辑 `wrangler.toml`：name = "notes-worker", main = "worker.js", compatibility_date = "2025-09-12", [[kv_namespaces]] binding = "NOTES_KV", id = "<你的 KV Namespace ID>"
5. 部署：wrangler publish

## 使用方法
- 首页显示笔记目录
- 点击笔记名进入编辑页
- 编辑页每 3 秒自动保存（不弹提示）
- 点击 💾 按钮可手动保存并显示“已保存”提示
- 新建笔记可通过随机生成链接或手动在 URL 后输入笔记名
- 访问根目录 `/` 查看笔记列表  
- 访问 `/你好` 创建或编辑笔记  
- 访问 `/你好?raw` 以纯文本方式输出内容  
## 一键部署
[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare%20Workers-brightgreen)](https://deploy.workers.cloudflare.com/?url=https://github.com/linaut/Cloudflare-notepad)
> ⚠️ 点击一键部署后，请在 Cloudflare 页面绑定 KV（NOTES_KV）后即可使用

## 截图示例
| 目录页                                                         | 编辑页                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| ![目录页](https://github.com/user-attachments/assets/b7b747c5-c997-48f4-81d9-340ab5b7dd23) | ![编辑页](https://github.com/user-attachments/assets/9f3613bd-b7c8-401f-b165-a10ad5735fb3) |





