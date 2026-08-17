# 东方财富 Windows OCR 只读适配器设计规格

日期：2026-08-17  
状态：待用户书面复核  
适用阶段：东方财富实盘交易网关 Phase 1（本地影子交易）

## 1. 背景与目标

东方财富交易窗口已经能够被本地交易桥识别，但交易区域使用 `CElementFrameWnd_DC` 与 `ContainerWnd_DC` 自绘容器。UI Automation 和传统 Win32 文本接口无法读取其中的资金与持仓字段。

本功能增加 Windows 本地 OCR 只读适配器，在不点击、不输入、不调用买卖控件的前提下，从当前东方财富交易窗口读取：

- 可用资金；
- 总资产；
- 持仓股票代码；
- 全部数量；
- 可用数量。

OCR 结果仅用于影子交易中的资金上限、持仓范围和 T+1 校验。Phase 1 继续固定 `safe_for_live=false`，不得由 OCR 结果触发真实下单。

## 2. 已确认的技术选择

采用 Windows 本地 OCR 与“锚点定位 + 区域解析”方案。

未选择整窗直接解析，因为菜单、行情和交易信息混合时误识别风险较高。未选择固定坐标方案，因为窗口尺寸、缩放比例和交易客户端升级会导致坐标失效。

Windows OCR 不提供可依赖的统一数值置信度，因此本系统不伪造置信度百分比。识别质量通过锚点完整性、字段格式、几何关系和业务交叉校验表示为：

- `verified_by_rules`：全部规则通过；
- `verification_required`：存在歧义，需要人工核对；
- `unavailable`：无法安全解析，不返回推测值。

## 3. 安全边界

- 只允许捕获已确认属于 `mainfree.exe` 的东方财富交易窗口客户区。
- 截图仅存在于当前进程内存，用完立即释放，不写入文件、缓存、数据库或日志。
- 不上传 Supabase、Railway、Netlify 或任何第三方 OCR 服务。
- 日志不得包含账户号、资金数值、股票代码、股票名称、持仓数量、窗口标题或原始 OCR 文本。
- OCR 适配器不得包含点击、键盘输入、控件 `invoke`、委托提交或撤单能力。
- 窗口最小化、句柄变化、画面空白、锚点缺失或字段冲突时必须安全失败。
- 成功读取后也必须由用户人工核对，不能自动覆盖网站实际持仓。

## 4. 组件设计

### 4.1 `EastmoneyTradingWindowLocator`

负责只读定位东方财富交易窗口：

- 进程必须为已识别的 `mainfree.exe`；
- 窗口必须可见、未最小化且客户区尺寸达到最低要求；
- 接受当前已确认的自绘交易窗口结构：顶层 `#32770`，内部包含 `CElementFrameWnd_DC` 与 `ContainerWnd_DC`；
- 多个候选窗口同时存在时不猜测，返回 `ambiguous_trading_window`；
- 不把已确认的东方财富交易窗口列为未知安全弹窗。

### 4.2 `InMemoryWindowCapture`

使用 Windows 原生窗口捕获能力读取客户区像素：

- 优先捕获窗口客户区而非整个桌面；
- 不包含桌面其他应用；
- 捕获结果为内存位图；
- 解析完成或发生异常时均释放 GDI 对象、位图缓冲区和图像对象；
- 空白、全黑、尺寸异常或捕获失败时返回明确错误，不继续 OCR。

### 4.3 `WindowsOcrBackend`

通过可注入协议封装 Windows OCR：

- 生产实现调用 Windows 本地 WinRT OCR；
- 测试实现返回脱敏合成 OCR 行与边界框；
- OCR 语言优先使用系统可用的简体中文；
- 系统缺少中文 OCR 能力时返回 `windows_ocr_unavailable`；
- 只向上层返回文本行、单词和边界框，不保留截图。

### 4.4 `EastmoneyAccountOcrParser`

解析流程：

1. 定位“可用资金”“总资产”“持仓”等标题锚点；
2. 根据锚点边界框确定限定解析区域；
3. 解析资金字段；
4. 根据表头与行的几何对齐关系解析持仓；
5. 执行格式与业务规则校验；
6. 返回结构化只读快照或安全失败原因。

解析器不得在关键字段缺失时使用默认值或历史值。

## 5. 字段规则

### 5.1 资金

- 支持 `1234.56` 与 `1,234.56` 格式；
- 只接受非负有限数值；
- 可用资金和总资产必须同时找到；
- 可用资金大于总资产时标记 `verification_required`，不标记规则验证通过。

### 5.2 持仓

- 股票代码必须为六位数字；
- 全部数量和可用数量必须为非负整数；
- 可用数量不得大于全部数量；
- 同一股票代码出现多行且数值不一致时返回 `conflicting_position_rows`；
- OCR 未识别到任何持仓行时，只有在明确识别到“无持仓”状态时才返回空列表，否则返回 `positions_anchor_missing` 或 `positions_unreadable`。

第一版不读取股票名称、成本价、最新价、盈亏、委托和成交记录。

## 6. 数据模型与本地接口

`/v1/account` 扩展为登录本地桥后的显式只读刷新接口，返回：

```text
mode: eastmoney_read_only
source: eastmoney_windows_ocr
available: boolean
captured_at: timezone-aware datetime | null
quality: verified_by_rules | verification_required | unavailable
verification_required: boolean
available_cash: number | null
total_assets: number | null
positions:
  - code: six-digit string
    total_shares: non-negative integer
    available_shares: non-negative integer
failure_reason: enum | null
```

允许的 `failure_reason` 至少包括：

- `trading_window_not_found`
- `ambiguous_trading_window`
- `trading_window_minimized`
- `window_capture_failed`
- `blank_capture`
- `windows_ocr_unavailable`
- `required_anchor_missing`
- `funds_unreadable`
- `positions_unreadable`
- `conflicting_position_rows`
- `field_validation_failed`

API 响应不得包含截图、原始 OCR 文本、窗口句柄、窗口标题、进程路径或账户号。

## 7. 工作台交互

影子交易工作台增加“读取东方财富账户”按钮：

- 默认不自动扫描；
- 用户点击后才调用本地桥；
- 显示连接状态、识别时间、可用资金、总资产及持仓的全部/可用数量；
- 始终显示“OCR 结果，请人工核对”；
- 提供刷新按钮；
- 识别失败时显示可操作的失败原因，不展示旧快照冒充当前数据；
- 用户确认前，不将结果用于影子订单资金或 T+1 校验；
- 用户确认只影响当前本地影子会话，不写入云端实际持仓。

## 8. 错误处理与生命周期

- 每次读取均生成独立快照，不复用上次 OCR 数值。
- 捕获、OCR、解析任一阶段异常时统一转换为脱敏错误码。
- 窗口在捕获期间关闭或改变尺寸时，本次读取失败并要求重试。
- 连续失败不自动循环截图，避免资源占用与敏感画面长期驻留内存。
- OCR 资源释放必须放在 `finally` 或等价的确定性清理路径中。
- 本功能不增加后台常驻扫描器；用户刷新时才读取。

## 9. 测试策略

