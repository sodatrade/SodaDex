import type { ReactElement } from 'react'
import { Button, Icon, Surface } from './primitives'

export function PoolsPage({ onSwap }: { onSwap: () => void }): ReactElement {
  return (
    <section className="content-page" aria-labelledby="pools-title">
      <div className="page-heading">
        <span className="eyebrow">LIQUIDITY / TEST</span>
        <h1 id="pools-title">为流动，留出更多可能。</h1>
        <p>低费率 V3 / V4 测试池准备中。</p>
      </div>
      <Surface className="pools-surface">
        <div className="pool-illustration" aria-hidden="true">
          <span />
          <Icon name="layers" size={42} />
          <span />
        </div>
        <h2>首批测试池即将准备就绪</h2>
        <p>
          合约部署及初始流动性完成后，
          <br />
          这里将展示可用的池子与添加流动性入口。
        </p>
        <div className="pool-fees">
          <div>
            <span>V3 计划费率</span>
            <strong>
              0.01<span>%</span>
            </strong>
          </div>
          <div>
            <span>V4 计划费率</span>
            <strong>
              0<span>%</span>
            </strong>
          </div>
          <div>
            <span>平台费 / 协议费</span>
            <strong>
              0<span>%</span>
            </strong>
          </div>
        </div>
        <Button onClick={onSwap}>
          返回兑换
          <Icon name="arrow" size={16} />
        </Button>
      </Surface>
    </section>
  )
}
