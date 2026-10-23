/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Issue #777: index each vault's haircut for the public solvency view.
 * Defaults to 0 like the agent_vault contract, so an unindexed vault backs no float.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE agent_vaults
      ADD COLUMN IF NOT EXISTS haircut_bps INTEGER NOT NULL DEFAULT 0
        CONSTRAINT agent_vaults_haircut_bps_range CHECK (haircut_bps BETWEEN 0 AND 10000)
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE agent_vaults DROP COLUMN IF EXISTS haircut_bps`);
};
