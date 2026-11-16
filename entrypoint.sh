#!/bin/sh
set -e

echo "🚀 [New Bhama Fashions ERP] Container starting up..."

# Ensure data and backup directories exist
mkdir -p /app/data/backups

DB_PATH="/app/data/bhama_store.sqlite"

# Production mode with Litestream & Google Cloud Storage
if [ -n "$GCS_BUCKET" ]; then
  echo "🔍 [Litestream] Checking for live database replica in gs://${GCS_BUCKET}/db/bhama_store.sqlite..."

  # Fail-fast restore:
  # - Exits 0 and restores DB if replica exists in GCS.
  # - Exits 0 without error if no replica exists yet (clean first-time boot).
  # - Exits non-zero on IAM/network/corruption errors so container aborts instead of overwriting production state.
  litestream restore -if-replica-exists -config /etc/litestream.yml "$DB_PATH"
  echo "✅ [Litestream] Pre-boot replica restore check completed."

  if [ -f "$DB_PATH" ]; then
    echo "🛡️ [Litestream] Restored existing production database at $DB_PATH."
  else
    echo "🌱 [Litestream] No existing replica in GCS yet. Application will initialize schema on first boot."
  fi

  echo "🔄 [Litestream] Starting continuous replication alongside ERP server..."
  exec litestream replicate -config /etc/litestream.yml -exec "node dist/server.cjs"
else
  echo "ℹ️ [Standalone] GCS_BUCKET not set. Running in local persistent disk mode."
  exec node dist/server.cjs
fi
