# 独立测试网络

`network-profile.ts` 是前端与静态文件 Worker 共用的可信网络配置。只允许以下两个名称：

| Profile | 网络 | 当前能力 |
| --- | --- | --- |
| `196-test`（默认） | X Layer 196；保留现有 IGNIX RPC | 原有 SodaDEX 测试合约、流动性、限价单和只读官方池 |
| `1952-mining-test` | X Layer 1952；官方测试 RPC | 网络状态、测试 OKB 余额和独立矿机产品；仅在回执核验 manifest 为 ready 后开放钱包操作 |

1952 的 RPC、链号和浏览器地址依据 [X Layer 官方网络信息](https://web3.okx.com/zh-hans/onchainos/dev-docs/xlayer/developer/build-on-xlayer/network-information)。不存在 1952 合约占位地址，不能把 196 地址复制过来当成已部署。

## 配置边界

- 前端以构建时 `VITE_SODADEX_NETWORK_PROFILE` 选择网络，未设置则保留 `196-test`；不接受 URL 或 localStorage 切换网络。
- Worker 以部署配置 `SODADEX_NETWORK_PROFILE` 选择网络，未设置则保留 `196-test`。无效配置返回不可用，不回退到其他网络。
- `/api/network` 返回链号及能力状态。1952 页面先核对前端与 Worker profile，再读取 RPC 链号；不一致时停止后续读取。
- 钱包的切链、添加网络、RPC 与区块浏览器均来自相同 profile。
- 1952 的独立入口不会执行 196 DEX 模块导入；误导入原有 196 资产模块会显式报错。原 196 资产、签名、池和扫描逻辑尚未泛化为 1952。
- 1952 Worker 拒绝 DEX 行情、官方参考行情和所有限价单路径，即使意外提供了 196 的订单 Service Binding 也不会转发。
- 1952 RPC 先核对上游链号；基础读取继续开放。`products.json` 为 ready 后，仅允许已登记产品的准确 ABI 读取、有限授权／交易模拟、pending 区块估算、代理槽和有限日志扫描；不签名、不广播、不接受状态覆盖或任意目标。

## 本地构建与后续接入

```sh
# 默认196构建不改变现有发布配置
npm --prefix standalone/web run build

# 构建1952独立资源，不覆盖默认dist
npm --prefix standalone/web run build:mining-test
```

1952 使用 `worker/wrangler.1952-test.jsonc`、独立名称 `sodadex-mining-test-1952` 和 `web/dist-mining-1952`，明确设置 `SODADEX_NETWORK_PROFILE=1952-mining-test`；不复用 `sodadex-preview` 或 `sodadex-orders-test`。发布前验证构建网络标记和 CSP hash。本轮公开合约已部署并核验，前端正在准备发布。

矿机/FAB/市场的已核验地址、ABI、起始区块和读取/写模拟白名单已接到独立矿机应用。不能仅将 `dexEnabled` 改成 `true`：通用 DEX/订单/行情消费者仍是 196 专用，必须先完成对应 1952 适配和回归。新的 1952 settlement 与订单服务尚未部署前，限价单持续禁用。

默认白天和中英粤偏好复用现有实现。pending 时显示准备页；ready 后按实际运行码、UUPS 槽、NFT beacon 和业务绑定逐项核验，再显示募资分红、矿机碎片、收益和本机交易记录。所有写操作由连接的钱包确认，前端不读取部署钱包。

## 独立测试站发布准备

公开1952已完成102笔成功交易，回执与运行码复核通过，`deployments/xlayer-1952/products.json` 已为ready。按以下独立入口人工发布。

```sh
npm --prefix standalone/web run build
npm --prefix standalone/web run build:mining-test
node scripts/sodadex/check-mining-web-build.mjs
npm --prefix standalone/worker run deploy:mining-test
```

第一步为 Worker 的公共偏好 CSP 产物；第二步生成1952独立资源。检查脚本要求两份偏好脚本 hash 一致，防止上传错误网络或 CSP 不匹配的资源。公开1952页面与已有196测试站分别部署。
