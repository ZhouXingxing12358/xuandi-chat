# 绑定自定义域名 xuandi-chat.ai

## 0. 先确认域名已购买

当前查询：`xuandi-chat.ai` **还不存在**。  
若还没买，先到阿里云 / 腾讯云 / Cloudflare / Namecheap 等注册该域名。

---

## 1. GitHub Pages 里填写域名

1. 打开：https://github.com/ZhouXingxing12358/xuandi-chat/settings/pages  
2. 先保证 Source = `main` / `(root)` 已开启  
3. **Custom domain** 填：`xuandi-chat.ai` → Save  
4. 勾选 **Enforce HTTPS**（DNS 生效后才可勾）

仓库里已有 `CNAME` 文件（内容为 `xuandi-chat.ai`）。

---

## 2. 在域名商添加 DNS（二选一）

### 推荐：只用 apex + www

在域名解析里添加：

| 类型 | 主机记录 | 记录值 |
|------|----------|--------|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `ZhouXingxing12358.github.io` |

（这 4 个 A 是 GitHub Pages 官方 IP。）

### 或者：只做 www

| 类型 | 主机记录 | 记录值 |
|------|----------|--------|
| CNAME | `www` | `ZhouXingxing12358.github.io` |

然后自定义域名填 `www.xuandi-chat.ai`。

---

## 3. 等待生效

- 一般几分钟到几小时  
- 本机验证：`nslookup xuandi-chat.ai` 应能看到上面的 IP  
- 然后打开：https://xuandi-chat.ai/

DNS 没好之前，同学仍可用：  
https://ZhouXingxing12358.github.io/xuandi-chat/
