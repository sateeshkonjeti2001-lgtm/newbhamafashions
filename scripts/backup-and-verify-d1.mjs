import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import initSqlJs from 'sql.js';

const DB_NAME = 'new-bhama-fashions-erp-db';
const DB_ID = 'b2c08216-28af-4b65-9e6c-88fb07388143';
const BACKUP_DIR = path.resolve(process.cwd(), 'd1-backups');

const REQUIRED_TABLES = [
  'users',
  'store_settings',
  'backup_settings',
  'products',
  'sales',
  'sale_items',
  'customers',
  'customer_dues',
  'customer_due_payments',
  'purchases',
  'financial_transactions',
  'daily_closings',
  'audit_logs',
];

const ALL_TABLES_TO_COUNT = [
  'users',
  'store_settings',
  'backup_settings',
  'categories',
  'brands',
  'models',
  'products',
  'product_variants',
  'suppliers',
  'purchases',
  'purchase_items',
  'purchase_batches',
  'stock_ledger',
  'customers',
  'sales',
  'sale_items',
  'customer_dues',
  'customer_due_payments',
  'financial_transactions',
  'financial_corrections',
  'expenses',
  'staff',
  'attendance',
  'salary_payments',
  'daily_closings',
  'loans',
  'assets',
  'loan_repayments',
  'sale_returns',
  'sale_return_items',
  'audit_logs',
  'backup_history',
  'daily_sequences',
];

function formatISTStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}${map.month}${map.day}_${map.hour}${map.minute}${map.second}_IST`;
}

export async function verifySqlBackupFile(sqlFilePath) {
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error(`Backup file not found: ${sqlFilePath}`);
  }
  const stat = fs.statSync(sqlFilePath);
  if (stat.size <= 0) {
    throw new Error(`Backup file is empty (0 bytes): ${sqlFilePath}`);
  }

  const rawSql = fs.readFileSync(sqlFilePath, 'utf8');
  const sha256 = crypto.createHash('sha256').update(rawSql, 'utf8').digest('hex');

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(rawSql);

    // Integrity check
    const intStmt = db.prepare('PRAGMA integrity_check;');
    let integrity = 'unknown';
    if (intStmt.step()) {
      const row = intStmt.getAsObject();
      integrity = String(Object.values(row)[0] || '');
    }
    intStmt.free();
    if (integrity.toLowerCase() !== 'ok') {
      throw new Error(`PRAGMA integrity_check failed: ${integrity}`);
    }

    // Foreign key check
    const fkStmt = db.prepare('PRAGMA foreign_key_check;');
    const fkViolations = [];
    while (fkStmt.step()) {
      fkViolations.push(fkStmt.getAsObject());
    }
    fkStmt.free();
    if (fkViolations.length > 0) {
      throw new Error(`PRAGMA foreign_key_check failed with ${fkViolations.length} violation(s)`);
    }

    // Existing tables check
    const tblStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table';");
    const existingTables = new Set();
    while (tblStmt.step()) {
      existingTables.add(String(tblStmt.getAsObject().name));
    }
    tblStmt.free();

    const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));
    if (missingTables.length > 0) {
      throw new Error(`Backup is missing required schema tables: ${missingTables.join(', ')}`);
    }

    // Active owner check
    const ownerStmt = db.prepare(
      "SELECT COUNT(*) as cnt FROM users WHERE role = 'OWNER' AND is_active = 1;"
    );
    let activeOwners = 0;
    if (ownerStmt.step()) {
      activeOwners = Number(ownerStmt.getAsObject().cnt || 0);
    }
    ownerStmt.free();

    if (activeOwners < 1) {
      throw new Error('Backup contains 0 active OWNER accounts — unsafe to restore or run fresh start.');
    }

    // Table row counts summary
    const tableCounts = {};
    for (const tbl of ALL_TABLES_TO_COUNT) {
      if (!existingTables.has(tbl)) continue;
      const cStmt = db.prepare(`SELECT COUNT(*) as cnt FROM "${tbl}";`);
      if (cStmt.step()) {
        tableCounts[tbl] = Number(cStmt.getAsObject().cnt || 0);
      }
      cStmt.free();
    }

    return {
      filePath: path.resolve(sqlFilePath),
      sizeBytes: stat.size,
      sha256,
      integrity,
      fkViolations: 0,
      activeOwners,
      tableCounts,
      verifiedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const verifyOnlyArg = args.find((a) => a.startsWith('--verify-only='));

  let targetFile;
  if (verifyOnlyArg) {
    targetFile = path.resolve(verifyOnlyArg.split('=').slice(1).join('='));
    console.log(`🔍 Verifying existing SQL backup file: ${targetFile}`);
  } else {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = formatISTStamp();
    targetFile = path.join(BACKUP_DIR, `nbf_prod_backup_${stamp}.sql`);

    console.log(`📦 Exporting remote Cloudflare D1 database '${DB_NAME}' (${DB_ID})...`);
    console.log(`📄 Destination: ${targetFile}`);
    try {
      execFileSync(
        'npx',
        ['wrangler', 'd1', 'export', DB_NAME, '--remote', '--output', targetFile],
        { encoding: 'utf8', stdio: 'inherit' }
      );
    } catch (err) {
      if (fs.existsSync(targetFile) && fs.statSync(targetFile).size === 0) {
        fs.unlinkSync(targetFile);
      }
      console.error('\n❌ Remote D1 export failed.');
      console.error('Make sure you are authenticated with Cloudflare (`npx wrangler login` or `CLOUDFLARE_API_TOKEN` env var).');
      process.exit(1);
    }
  }

  console.log('🛡️ Running SQLite integrity, foreign-key, schema, and active-owner verification...');
  const manifest = await verifySqlBackupFile(targetFile);

  const metaPath = `${targetFile}.meta.json`;
  fs.writeFileSync(metaPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('\n✅ PRODUCTION BACKUP VERIFIED SUCCESSFULLY');
  console.log(`   File:          ${manifest.filePath}`);
  console.log(`   Size:          ${manifest.sizeBytes.toLocaleString()} bytes`);
  console.log(`   SHA-256:       ${manifest.sha256}`);
  console.log(`   Integrity:     ${manifest.integrity}`);
  console.log(`   FK Check:      0 violations`);
  console.log(`   Active Owners: ${manifest.activeOwners}`);
  console.log(`   Manifest:      ${metaPath}`);
  console.log('\n📊 Key Table Counts:');
  for (const key of ['users', 'store_settings', 'products', 'sales', 'customers', 'customer_dues', 'purchases', 'financial_transactions', 'daily_closings']) {
    if (manifest.tableCounts[key] !== undefined) {
      console.log(`   - ${key}: ${manifest.tableCounts[key]}`);
    }
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main().catch((err) => {
    console.error('❌ Backup verification failed:', err?.message || err);
    process.exit(1);
  });
}
