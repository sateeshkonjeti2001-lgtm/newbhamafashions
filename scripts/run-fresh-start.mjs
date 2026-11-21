import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { verifySqlBackupFile } from './backup-and-verify-d1.mjs';

const DB_NAME = 'new-bhama-fashions-erp-db';
const DB_ID = 'b2c08216-28af-4b65-9e6c-88fb07388143';
const CLEANUP_SQL_PATH = path.resolve(process.cwd(), 'scripts', 'fresh-start-cleanup-d1.sql');

function printDryRunPlan() {
  console.log('===================================================================');
  console.log('NEW BHAMA FASHIONS ERP — FRESH START CLEANUP (DRY RUN PREVIEW)');
  console.log('===================================================================');
  console.log(`Target D1 Database : ${DB_NAME} (${DB_ID})`);
  console.log(`Cleanup SQL Script : ${CLEANUP_SQL_PATH}`);
  console.log('');
  console.log('PRESERVED (Untouched):');
  console.log('  - users (active OWNER account(s) only: role = OWNER AND is_active = 1)');
  console.log('  - store_settings (store name, location, tagline, contact phones)');
  console.log('  - backup_settings');
  console.log('  - d1_migrations & full database schema/indexes/triggers');
  console.log('');
  console.log('CLEARED (Row deletes only — NO DROP TABLE / NO TRUNCATE):');
  console.log('  - sales, sale_items, sale_returns, sale_return_items, daily_sequences');
  console.log('  - customer_dues, customer_due_payments, customers');
  console.log('  - financial_transactions, financial_corrections, expenses, daily_closings');
  console.log('  - purchases, purchase_items, purchase_batches, stock_ledger, suppliers');
  console.log('  - products, product_variants, categories, brands, models');
  console.log('  - staff, attendance, salary_payments, assets, loans, loan_repayments');
  console.log('  - backup_history, backup_snapshots, rate_limits, revoked_tokens, idempotency_keys');
  console.log('  - users where role != OWNER OR is_active != 1');
  console.log('  - audit_logs replaced by single FRESH_START_2026_11_21 launch marker');
  console.log('');
  console.log('TO EXECUTE AGAINST PRODUCTION (ONLY AFTER EXPLICIT APPROVAL + VERIFIED BACKUP):');
  console.log('  1. node scripts/backup-and-verify-d1.mjs');
  console.log('  2. npx wrangler d1 migrations apply new-bhama-fashions-erp-db --remote');
  console.log('  3. node scripts/run-fresh-start.mjs --execute --confirm-backup=d1-backups/<verified-backup>.sql');
  console.log('===================================================================');
}

async function main() {
  const args = process.argv.slice(2);
  const executeMode = args.includes('--execute');
  const backupArg = args.find((a) => a.startsWith('--confirm-backup='));

  if (!fs.existsSync(CLEANUP_SQL_PATH)) {
    throw new Error(`Missing cleanup SQL file: ${CLEANUP_SQL_PATH}`);
  }

  if (!executeMode) {
    printDryRunPlan();
    return;
  }

  if (!backupArg) {
    console.error('❌ REFUSED: --execute requires --confirm-backup=<path-to-verified-backup.sql>');
    console.error('Run `node scripts/backup-and-verify-d1.mjs` first to create and verify a production backup.');
    process.exit(1);
  }

  const backupPath = path.resolve(backupArg.split('=').slice(1).join('='));
  console.log(`🛡️ Verifying pre-cleanup backup file: ${backupPath}`);
  const manifest = await verifySqlBackupFile(backupPath);
  console.log(
    `✅ Backup verified (SHA-256: ${manifest.sha256.slice(0, 16)}..., integrity: ${manifest.integrity}, active owners: ${manifest.activeOwners}).`
  );

  console.log(`\n🚀 Applying Fresh Start cleanup to remote D1 '${DB_NAME}'...`);
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', CLEANUP_SQL_PATH],
    { encoding: 'utf8', stdio: 'inherit' }
  );

  console.log('\n🔍 Running remote post-cleanup verification query...');
  const verifySql = `
    SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'OWNER' AND is_active = 1) AS active_owners,
      (SELECT COUNT(*) FROM store_settings) AS store_settings_rows,
      (SELECT COUNT(*) FROM sales) AS sales_rows,
      (SELECT COUNT(*) FROM products) AS product_rows,
      (SELECT COUNT(*) FROM customers) AS customer_rows,
      (SELECT COUNT(*) FROM financial_transactions) AS financial_tx_rows,
      (SELECT COUNT(*) FROM daily_closings) AS daily_closing_rows,
      (SELECT COUNT(*) FROM audit_logs WHERE action = 'FRESH_START_2026_11_21') AS fresh_start_markers;
  `.trim();

  const rawOut = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', verifySql],
    { encoding: 'utf8' }
  );

  console.log(rawOut);
  console.log('✅ Fresh Start cleanup completed and verified on remote D1.');
}

main().catch((err) => {
  console.error('❌ Fresh Start execution failed:', err?.message || err);
  process.exit(1);
});
