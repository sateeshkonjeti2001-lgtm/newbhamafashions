#!/bin/sh
set -e

echo "🚀 [New Bhama Fashions ERP] Container starting up..."

# Ensure data and backup directories exist
mkdir -p /app/data/backups

DB_PATH="/app/data/bhama_store.sqlite"
SEED_PATH="/app/seed_data/bhama_store.sqlite"

# Production mode with Litestream & Google Cloud Storage
if [ -n "$GCS_BUCKET" ]; then
  echo "🔍 [Litestream] Checking for live database replica in gs://${GCS_BUCKET}/db/bhama_store.sqlite..."

  # Attempt restore from GCS replica first
  # -if-replica-exists: restores from GCS only if a valid replica was previously uploaded
  if litestream restore -if-replica-exists -config /etc/litestream.yml "$DB_PATH"; then
    echo "✅ [Litestream] Restore check complete."
  fi

  # If no database exists at all (brand new deployment, first time boot), seed from /app/seed_data
  if [ ! -f "$DB_PATH" ]; then
    if [ -f "$SEED_PATH" ]; then
      echo "🌱 [Litestream] No replica found in GCS. Initializing first boot from verified seed database..."
      cp "$SEED_PATH" "$DB_PATH"
    else
      echo "⚠️ [Litestream] No seed database found. SQLite will initialize a fresh database on start."
    fi
  else
    echo "🛡️ [Litestream] Database verified at $DB_PATH. Live production data preserved."
  fi

  echo "🔄 [Litestream] Starting continuous WAL replication alongside ERP server..."
  exec litestream replicate -config /etc/litestream.yml -exec "node dist/server.cjs"
else
  # Standalone local development or testing mode
  if [ ! -f "$DB_PATH" ] && [ -f "$SEED_PATH" ]; then
    echo "🌱 [Standalone] Seeding local database..."
    cp "$SEED_PATH" "$DB_PATH"
  fi
  echo "ℹ️ [Standalone] Running in local persistent disk mode."
  exec node dist/server.cjs
fi
