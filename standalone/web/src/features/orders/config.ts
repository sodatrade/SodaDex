import { orderDeployment } from '../../../../order-deployment'
import manifest from '../../../../../deployments/orders-test.json'
export { orderDeployment, type OrderDeployment } from '../../../../order-deployment'
export const ORDER_DEPLOYMENT = orderDeployment(manifest)
