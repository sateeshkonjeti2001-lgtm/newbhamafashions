import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { CORE_ERP_TABLES } from '../server/schemaSql.ts';

function escapeSqlValue(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (val instanceof Uint8Array) {
    let hex = '';
    for (let i = 0; i < val.length; i++) {
      hex += val[i].toString(16).padStart(2, '0');
    }
    return `X'${hex}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function main() {
  const inputPath = path.resolve(process.argv[2] || path.join(process.cwd(), 'data', 'bhama_store.sqlite'));
  const outputPath = path.resolve(process.argv[3] || path.join(process.cwd(), 'data', 'd1_import.sql'));

  if (!fs.existsSync(inputPath)) {
    console.error(`Source SQLite database not found: ${inputPath}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(inputPath));

  const lines: string[] = [
    '-- New Bhama Fashions ERP - SQLite to Cloudflare D1 Data Export',
    `-- Source File: ${path.basename(inputPath)}`,
    `-- Exported At: ${new Date().toISOString()}`,
    '-- NOTE: Apply migrations first with: npx wrangler d1 migrations apply new-bhama-fashions-erp-db --remote',
    '-- NOTE: Then import data with: npx wrangler d1 execute new-bhama-fashions-erp-db --remote --file=data/d1_import.sql',
    '',
  ];

  // Clear tables in reverse FK dependency order so repeated imports are clean
  const reversedTables = [...CORE_ERP_TABLES].reverse();
  for (const tbl of reversedTables) {
    lines.push(`DELETE FROM "${tbl}";`);
  }
  lines.push('');

  let totalRows = 0;
  let legacyBcryptUsers = 0;

  for (const tbl of CORE_ERP_TABLES) {
    let rows: Record<string, any>[] = [];
    try {
      const stmt = db.prepare(`SELECT * FROM "${tbl}"`);
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
    } catch {
      continue;
    }

    if (rows.length === 0) continue;

    if (tbl === 'users') {
      for (const r of rows) {
        if (typeof r.password_hash === 'string' && r.password_hash.startsWith('$2')) {
          legacyBcryptUsers++;
        }
      }
    }

    const cols = Object.keys(rows[0]);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    lines.push(`-- Table: ${tbl} (${rows.length} rows)`);
    for (const row of rows) {
      const vals = cols.map((c) => escapeSqlValue(row[c])).join(', ');
      lines.push(`INSERT INTO "${tbl}" (${colList}) VALUES (${vals});`);
    }
    lines.push('');
    totalRows += rows.length;
  }

  db.close();

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');

  console.log(`Exported ${totalRows} rows across ${CORE_ERP_TABLES.length} tables to ${outputPath}`);
  if (legacyBcryptUsers > 0) {
    console.warn(
      `Notice: ${legacyBcryptUsers} user(s) still use legacy bcrypt password hashes. On first login after D1 import, their hash auto-upgrades to native WebCrypto PBKDF2-SHA256.`
    );
  }
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
