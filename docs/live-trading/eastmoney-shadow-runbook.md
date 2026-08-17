# 东方财富影子交易验证运行手册

## 边界

本阶段仅用于本地影子交易和东方财富桌面端只读能力探测：

- 不向券商提交、撤销或修改真实订单。
- 不点击东方财富的买入、卖出、撤单或确认控件。
- 不向 Netlify、Supabase 或 Railway 写入影子订单。
- 本地桥只绑定 `127.0.0.1`，每次由 Electron 生成新的 32 字节随机令牌。
- 渲染页面无法读取桥令牌、子进程环境、券商路径或凭据。
- Phase 1 即使通过 20 笔验证，也不会出现开启实盘的开关。

## 首次安装

1. 安装并登录东方财富 Windows 桌面交易客户端，确认账户、资金和持仓页面可正常打开。
2. 安装 Python 3.12 与 Node.js 20.19 或更高版本。
3. 初始化本地桥：

```powershell
cd C:\Users\33755\Desktop\投资尽调模型\.worktrees\live-trading-shadow\trading-bridge
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[test]"
```

4. 安装前端依赖：

```powershell
cd C:\Users\33755\Desktop\投资尽调模型\.worktrees\live-trading-shadow\app
npm ci
```

## 启动

正常使用时由 Electron 自动启动和停止本地桥：

```powershell
cd C:\Users\33755\Desktop\投资尽调模型\.worktrees\live-trading-shadow\app
npm run electron:dev
```

如果需要单独诊断桥接服务，必须先设置一次性令牌：

```powershell
cd C:\Users\33755\Desktop\投资尽调模型\.worktrees\live-trading-shadow\trading-bridge
$env:TRADING_BRIDGE_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
$env:TRADING_BRIDGE_HOST = '127.0.0.1'
.\.venv\Scripts\python.exe -m trading_bridge.app
```

不要把令牌写进源码、`.env`、截图、报告或 Git。

## 运行只读探测

1. 打开东方财富桌面客户端并完成登录。
2. 关闭或处理所有不明弹窗；探测不会代替用户确认弹窗。
3. 在证券工作台点击“影子交易验证”。
4. 确认页面显示“本地交易桥在线”。
5. 点击“运行东方财富只读探测”。
6. 复核以下字段：进程、主窗口、登录状态、资金、持仓、委托与撤单控件是否可读。
7. 只要存在未知模态弹窗，`safeForShadow` 必须为 `false`。
8. `safeForLive` 在 Phase 1 永远为 `false`。

探测代码只允许枚举进程、窗口、自动化 ID、控件类型和可见文本。复核源码时，不应出现 `click_input`、`type_keys`、`set_edit_text`、控件 `invoke` 或真实买卖方法。

## 导出脱敏探测证据

桥返回的账户号等连续六位以上数字会替换为 `[REDACTED]`，可执行文件路径只返回 SHA-256 摘要。独立诊断时可将已脱敏响应保存为 JSON：

```powershell
$headers = @{ 'X-Bridge-Token' = $env:TRADING_BRIDGE_TOKEN }
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8765/v1/eastmoney/probe' -Headers $headers |
  ConvertTo-Json -Depth 8 |
  Set-Content -Encoding utf8 '.\eastmoney-probe-redacted.json'
```

导出后仍需人工确认文件中不存在账户号、姓名、完整安装路径或任何凭据。

## 生成 20 笔影子订单

1. 影子页面只扫描当前登录账号的自选股；未登录本地模式读取本机自选股池。
2. 点击“扫描当前账号自选股”。
3. 确认候选数据有效，短线至少为买入信号，中线至少为观察等待。
4. 进入短线区间但尚未达到正式买入价时只观察。
5. 实时价格达到正式建议买入价且风险检查通过时，才可生成影子买入单。
6. 每笔影子订单必须冻结候选、风险和费用快照。
7. 最少 20 笔有效终态订单，并覆盖：
   - 核心买入
   - 订单过期或取消
   - 普通卖出
   - 硬止损
   - T+1 卖出阻断
   - 做 T 卖出
   - 做 T 回补
   - 部分成交
   - 重复订单拒绝
   - 本地桥重启恢复
8. 错代码、错方向、错数量、重复执行或检测到真实提交，均为阻断失败。

20 笔通过只表示可以开始复核 Phase 2 设计，不代表允许真实交易。

## 测试与复核

```powershell
cd C:\Users\33755\Desktop\投资尽调模型\.worktrees\live-trading-shadow\app
npm run typecheck
npm test -- src/features/securities/live-trading src/features/securities/t-trading src/features/securities/WatchlistPage.test.tsx src/features/securities/StockAnalysisRealtimeTargets.test.tsx src/app/router.test.tsx
npm run lint
npm run build

cd ..\trading-bridge
.\.venv\Scripts\python.exe -m pytest -q
```

## 故障处理

- 桥离线：关闭 Electron，确认 `.venv\Scripts\python.exe` 存在，再重新运行 `npm run electron:dev`。
- 探测不到客户端：确认使用 Windows 桌面客户端而不是手机或网页，且客户端进程已启动。
- 未知弹窗：人工查看并处理；不要让自动化点击。
- 订单超时：保留影子记录，标记为过期，不自动提高价格追单。
- 桥重启：旧令牌立即失效，新进程生成新令牌；验证重启恢复场景后再继续。
- 任何真实券商订单迹象：立即停止桥和 Electron，将该次验证标记为 `live_submission_detected` 阻断失败。
