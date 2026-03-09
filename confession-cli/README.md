# confession-cli

Confession 的命令列工具，可在專案中快速初始化 `.confession` 並觸發掃描。

## 安裝

```bash
npm i -g confession-cli
```

## 指令

```bash
confession init
confession scan
confession list --status open
confession status
```

## 可用參數

- `confession scan --api <baseUrl>`：指定 API 位址（預設讀取 `.confession/config.json`）
- `confession scan --depth quick|standard|deep`：覆寫掃描深度
- `confession list --status <open|fixed|ignored>`
- `confession list --severity <critical|high|medium|low|info>`
- `confession list --search <keyword>`

## 行為說明

- 未知旗標或非法列舉值會直接失敗（非 0 exit code）
- `confession scan` 輪詢逾時或收到 `SIGINT`（Ctrl+C）時，會先送出 `/api/scan/cancel/:id` 取消請求

## 專案根目錄解析

- 優先使用 `CONFESSION_PROJECT_ROOT`
- 未設定時使用 `process.cwd()`
