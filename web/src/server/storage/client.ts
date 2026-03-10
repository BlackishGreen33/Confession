export type { StorageScopedClient } from './client-core'
export {
  getConfessionDir,
  getStoragePath,
  loadScanTaskOnlySnapshot,
  loadSnapshot,
  loadVulnerabilityOnlySnapshot,
  resolveProjectRoot,
  saveScanTaskOnlySnapshot,
  saveSnapshot,
  saveVulnerabilityOnlySnapshot,
  storage,
  withFileLock,
  withVulnerabilityWriteClient,
} from './client-core'
