# 独立测试网络

`network-profile.ts` 是前端与静态文件 Worker 共用的可信网络配置。只允许以下两个名称：

| Profile | 网络 | 当前能力 |
| --- | --- | --- |
| `196-test`（默认） | X Layer 196；保留现有 IGNIX RPC | 原有 SodaDEX 测试合约、流动性、限价单和只读官方池 |
| `1952-mining-test` | X Layer 1952；官方测试 RPC | 网络状态、测试 OKB 余额、回执和基础链读取；矿机业务等待独立部署 |

1952 的 RPC、链号和浏览器地址依据 [X Layer 官方网络信息](https://web3.okx.com/zh-hans/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information)。不存在 1952 合约占位地址，不能把 196 地址复制过来当成已部署。

## 配置边界

- 前端以构建时 `VITE_SODADEX_NETWORK_PROFILE` 选择网络，未设置则保留 `196-test`；不接受 URL 或 localStorage 切换网络。
- Worker 以部署配置 `SODADEX_NETWORK_PROFILE` 选择网络，未设置则保留 `196-test`。无效配置返回不可用，不回退到其他网络。
- `/api/network` 返回链号及能力状态。1952 页面先核对前端与 Worker profile，再读取 RPC 链号；不一致时停止后续读取。
- 钱包的切链、添加网络、RPC 与区块浏览器均来自相同 profile。
- 1952 的独立入口不会执行 196 DEX 模块导入；误导入原有 196 资产模块会显式报错。原 196 资产、签名、池和扫描逻辑尚未泛化为 1952。
- 1952 Worker 拒绝 DEX 行情、官方参考行情和所有限价单路径，即使意外提供了 196 的订单 Service Binding 也不会转发。
- 1952 RPC 仅允许基础链读取；每次读取资产余额、回执等数据前先核对上游链号。不开放 `eth_call`、授权模拟、交易估算、日志扫描、签名或广播。

## 本地构建与后续接入

```sh
# 默认196构建不改变现有发布配置
npm --prefix standalone/web run build

# 在独立工作树中构建1952准备页；不得用原196发布命令发布此构建
VITE_SODADEX_NETWORK_PROFILE=1952-mining-test npm --prefix standalone/web run build
```

此改动没有创建或修改云端部署。1952 后续须使用独立 Worker 名称、资产构建目录和部署清单，明确设置 `SODADEX_NETWORK_PROFILE=1952-mining-test`；不得复用现有 `sodadex-preview` 发布配置或 `sodadex-orders-test` 服务。

真实部署完成后，将矿机/FAB/市场的已核验地址、ABI、起始区块和读取/写模拟白名单接到独立矿机应用。不能仅将 `dexEnabled` 改成 `true`：现有 DEX/订单/行情消费者仍是 196 专用，必须先完成对应 1952 适配和回归。新的 1952 settlement 与订单服务尚未部署前，限价单持续禁用。

默认白天和中英粤偏好复用现有实现；1952 准备页明确显示合约未就绪，只连接钱包及读取测试余额，不提供签名或发送入口。
