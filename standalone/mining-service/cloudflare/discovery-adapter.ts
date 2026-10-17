import { ServiceError, type Discovery } from '../src/types.ts'
/** Owner integration replaces this composition adapter with the shared chain verifier.
 * Fail closed until that real verifier is connected; fixtures inject Discovery directly. */
export const discovery: Discovery = {
  async verifyBase() { throw new ServiceError('discovery_not_wired', 503) },
  async resolveProject() { throw new ServiceError('discovery_not_wired', 503) },
}
