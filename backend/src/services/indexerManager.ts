import { EventIndexer } from './eventIndexer.js';
import logger from '../utils/logger.js';
import { getStellarRpcUrl } from '../config/stellar.js';
import { env } from '../config/env.js';

let indexerInstance: EventIndexer | null = null;

/**
 * Initialize and start the event indexer
 */
export const startIndexer = (): void => {
  if (indexerInstance) {
    logger.withContext().warn('Indexer already running');
    return;
  }

  const contractEnvMap: Record<string, string | undefined> = {
    LOAN_MANAGER_CONTRACT_ID: env.LOAN_MANAGER_CONTRACT_ID,
    LENDING_POOL_CONTRACT_ID: env.LENDING_POOL_CONTRACT_ID,
    REMITTANCE_NFT_CONTRACT_ID: env.REMITTANCE_NFT_CONTRACT_ID,
    MULTISIG_GOVERNANCE_CONTRACT_ID: env.MULTISIG_GOVERNANCE_CONTRACT_ID,
    AGENT_REGISTRY_CONTRACT_ID: env.AGENT_REGISTRY_CONTRACT_ID,
    AGENT_VAULT_CONTRACT_ID: env.AGENT_VAULT_CONTRACT_ID,
  };

  for (const [envVar, value] of Object.entries(contractEnvMap)) {
    if (!value || value.trim().length === 0) {
      logger.warn(`${envVar} is not set; events for that contract will not be indexed`);
    }
  }

  const contractIds = Object.values(contractEnvMap).filter((id): id is string =>
    Boolean(id && id.trim().length > 0),
  );
  const pollIntervalMs = env.INDEXER_POLL_INTERVAL_MS;
  const batchSize = env.INDEXER_BATCH_SIZE;
  const finalityDepth = env.INDEXER_FINALITY_DEPTH ?? 5;

  if (contractIds.length === 0) {
    logger
      .withContext()
      .warn(
        'No contract IDs set for indexer. Set LOAN_MANAGER_CONTRACT_ID, LENDING_POOL_CONTRACT_ID, REMITTANCE_NFT_CONTRACT_ID, MULTISIG_GOVERNANCE_CONTRACT_ID, AGENT_REGISTRY_CONTRACT_ID, or AGENT_VAULT_CONTRACT_ID.',
      );
    return;
  }

  const rpcUrl = getStellarRpcUrl();

  // agent_vault's CollateralDeposited event shares its name with the
  // lending pool's own CollateralDeposited event but has a different
  // topic/value shape, so the indexer needs to know which contract ids
  // belong to the agent vault contract to disambiguate when parsing.
  const agentVaultContractIds = [contractEnvMap.AGENT_VAULT_CONTRACT_ID].filter(
    (id): id is string => Boolean(id && id.trim().length > 0),
  );

  indexerInstance = new EventIndexer({
    rpcUrl,
    contractConfigs: contractIds.map((contractId) => ({ contractId })),
    agentVaultContractIds,
    pollIntervalMs,
    batchSize,
    finalityDepth,
  });

  indexerInstance.start().catch((error) => {
    logger.withContext().error('Failed to start indexer', { error });
    indexerInstance = null;
  });

  logger.withContext().info('Event indexer initialized', {
    rpcUrl,
    contractIds,
    pollIntervalMs,
    batchSize,
    finalityDepth,
  });
};

/**
 * Stop the event indexer
 */
export const stopIndexer = async (): Promise<void> => {
  if (indexerInstance) {
    await indexerInstance.stop();
    indexerInstance = null;
    logger.withContext().info('Event indexer stopped');
  }
};

/**
 * Get indexer instance (for testing)
 */
export const getIndexer = (): EventIndexer | null => {
  return indexerInstance;
};
