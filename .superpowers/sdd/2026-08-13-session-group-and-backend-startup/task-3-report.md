# Task 3 Report: 首次后端初始化状态与重试

## 范围与文件

- `src/stores/via.ts`
- `src/stores/via.spec.ts`

## RED 证据

执行 `npm test -- src/stores/via.spec.ts`（实现前）：4 个测试中 2 个失败。

- `retries startup loading and becomes ready after the backend is available`
- `fails startup loading after three unavailable backend attempts`

两者均因 `store.initializationState` 为 `undefined`、期望为 `connecting` 而失败，证明现有 store 缺少所需初始化状态与重试行为。

## 实现

- 导出 `InitializationState` 联合类型，并向 `ViaStore` 和响应式 state 添加 `initializationState`，初始值为 `idle`。
- `initialize()` 启动时改为 `connecting`；仅 `load_config` 最多尝试 3 次，失败间隔为 500ms。
- 三次均失败时设为 `failed` 并重新抛出最后一次错误。
- 在配置替换及既有 `runtime-state` 监听器设置完成后，保留 `initialized = true` 并将状态设为 `ready`。
- 未修改 runtime-state 处理、2 秒轮询间隔或隧道重连代码。

## GREEN 证据

执行：

```text
npm test -- src/stores/via.spec.ts
Test Files  1 passed (1)
Tests       4 passed (4)

npm run typecheck
vue-tsc --noEmit
```

两个新测试使用 fake timers，并通过 `try/finally` 恢复 real timers：

- 首次失败后等待 500ms，第二次成功时状态为 `ready`。
- 连续三次失败、总共推进 1,000ms 后，初始化抛出最后错误且状态为 `failed`。

## 自检

- 失败重试次数为 3，且仅两次失败间隔等待 500ms。
- 成功时不会额外等待或调用 `load_config`。
- `ready` 赋值位于配置替换和监听器注册之后。
- 原有 polling 和 reconnect 语句未改动。

## Concerns

无已知问题。`initialize()` 原本未定义并发或重复调用语义，本任务保持该行为不变。
