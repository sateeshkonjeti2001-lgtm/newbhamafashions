export type UserRole = 'OWNER' | 'CASHIER';

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: UserRole;
  phone?: string;
  is_active?: number;
  created_at?: string;
}

export interface StoreProfile {
  store_name: string;
  store_location: string;
  store_tagline: string;
  contact_phone_1: string;
  contact_phone_2: string;
  contact_phone_3: string;
  owner?: User;
  owners?: User[];
}

export interface Category {
  id: string;
  name: string;
  code?: string;
  description?: string;
  attributes_schema?: string[]; // e.g. ["Fabric", "Occasion", "Work"]
  is_active: number;
  created_at: string;
}

export interface Brand {
  id: string;
  name: string;
  is_active: number;
  created_at: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size?: string;
  color?: string;
  sku?: string;
  barcode?: string;
  mrp: number;
  selling_price: number;
  purchase_cost?: number;
  festival_discount?: number;
  is_active: number;
}

export interface Product {
  id: string;
  category_id?: string;
  brand_id?: string;
  model_id?: string;
  name: string;
  code?: string;
  sku?: string;
  barcode?: string;
  description?: string;
  tags?: string;
  mrp: number;
  selling_price: number;
  purchase_cost?: number;
  festival_discount?: number;
  category_attributes?: Record<string, any>;
  image_url?: string;
  is_active: number;
  category_name?: string;
  brand_name?: string;
  current_stock: number;
  variants?: ProductVariant[];
  created_at: string;
}

export interface CartItem {
  product: Product;
  variant?: ProductVariant;
  variant_id?: string;
  product_name: string;
  variant_desc?: string;
  quantity: number;
  mrp: number;
  unit_price: number; // Normal selling price
  festival_discount?: number; // Pre-configured festival discount per unit
  special_discount?: number; // Manual fixed ₹ discount per unit entered by Owner
  discount: number; // Total combined discount for the line
  total_price: number; // Final payable for the line
}

export interface Sale {
  id: string;
  bill_number: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  total_mrp?: number;
  subtotal: number;
  festival_discount?: number;
  special_discount?: number;
  discount_amount: number;
  discount_type?: 'AMOUNT' | 'PERCENT';
  total_amount: number;
  total_savings?: number;
  amount_paid: number;
  balance_due: number;
  payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
  payment_method: 'CASH' | 'UPI' | 'SPLIT' | 'CREDIT';
  cash_paid?: number;
  upi_paid?: number;
  channel: string;
  notes?: string;
  cashier_id?: string;
  cashier_name?: string;
  day_closed: number;
  created_at: string;
  items?: any[];
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  total_purchases: number;
  total_dues: number;
  created_at: string;
}

export interface CustomerDue {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_phone?: string;
  sale_id?: string;
  bill_number?: string;
  original_due: number;
  amount_paid: number;
  balance_due: number;
  status: 'PENDING' | 'CLEARED';
  notes?: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  gst_or_pan?: string;
  notes?: string;
  total_dues?: number;
  total_invoices?: number;
  is_active: number;
  created_at: string;
}

export interface Purchase {
  id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_phone?: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  paid_amount: number;
  balance_due: number;
  payment_status: 'PAID' | 'PARTIAL' | 'UNPAID';
  payment_method?: string;
  notes?: string;
  created_by_name?: string;
  created_at: string;
  items?: any[];
}

export interface StockLedgerEntry {
  id: string;
  product_id: string;
  product_name: string;
  product_code?: string;
  variant_id?: string;
  movement_type: 'PURCHASE' | 'SALE' | 'CUSTOMER_RETURN' | 'SUPPLIER_RETURN' | 'DAMAGE' | 'WRITE_OFF' | 'ADJUSTMENT';
  quantity: number;
  unit_cost?: number;
  reference_type: string;
  reference_id?: string;
  reason?: string;
  created_by_name?: string;
  created_at: string;
}

export interface FinancialTransaction {
  id: string;
  date: string;
  amount: number;
  source_account: 'CASH' | 'UPI' | 'BANK' | 'EXTERNAL';
  destination_account: 'CASH' | 'UPI' | 'BANK' | 'EXTERNAL';
  transaction_type: string;
  person_entity?: string;
  category?: string;
  purpose: string;
  payment_method: string;
  reference_no?: string;
  notes?: string;
  is_system_generated: number;
  is_reversed: number;
  original_tx_id?: string;
  day_closed: number;
  user_name?: string;
  created_at: string;
  updated_at: string;
}

export interface StaffMember {
  id: string;
  name: string;
  phone?: string;
  role_title: string;
  monthly_salary?: number;
  joining_date: string;
  address?: string;
  emergency_contact?: string;
  is_active: number;
}

export interface AttendanceRecord {
  id: string;
  staff_id: string;
  staff_name: string;
  role_title: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE';
  check_in_time?: string;
  check_out_time?: string;
  notes?: string;
  marked_by_name?: string;
}

export interface DailyClosing {
  id: string;
  closing_date: string;
  opening_cash: number;
  cash_sales: number;
  cash_received_other: number;
  cash_expenses: number;
  cash_paid_other: number;
  expected_closing_cash: number;
  actual_counted_cash: number;
  difference_cash: number;
  upi_sales: number;
  upi_received_other: number;
  upi_payments: number;
  closing_notes?: string;
  status: 'OPEN' | 'CLOSED';
  closed_by_name?: string;
  closed_at?: string;
}

export interface Asset {
  id: string;
  name: string;
  category?: string;
  purchase_date: string;
  purchase_cost: number;
  condition?: string;
  notes?: string;
}

export interface BusinessLoan {
  id: string;
  lender_name: string;
  principal_amount: number;
  interest_rate: number;
  start_date: string;
  monthly_emi?: number;
  balance_amount: number;
  notes?: string;
}

export interface AuditLogEntry {
  id: string;
  user_id?: string;
  user_name?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  changes?: any;
  created_at: string;
}

export interface AssetRecord {

  id: string;
  name: string;
  purchase_date: string;
  purchase_value: number;
  funding_source: string;
  loan_id?: string;
  lender_name?: string;
  current_status: 'ACTIVE' | 'SOLD' | 'DISPOSED';
  disposal_date?: string;
  disposal_value?: number;
  profit_or_loss?: number;
  notes?: string;
}

export interface LoanRecord {
  id: string;
  lender_name: string;
  loan_amount: number;
  loan_date: string;
  interest_info?: string;
  total_repaid: number;
  outstanding_balance: number;
  status: 'ACTIVE' | 'CLOSED';
  notes?: string;
}

export interface AuditLogItem {
  id: string;
  user_id?: string;
  username?: string;
  user_full_name?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details?: any;
  created_at: string;
}

export interface BackupRecord {
  id: string;
  filename: string;
  filepath: string;
  backup_type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
  file_size: number;
  checksum_sha256: string;
  schema_version: string;
  status: 'SUCCESS' | 'FAILED';
  verification_status: 'VERIFIED' | 'FAILED' | 'UNCHECKED';
  verification_details?: string | null;
  table_counts?: Record<string, number> | null;
  error_message?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  notes?: string | null;
  is_locked: number;
  created_at: string;
}

export interface BackupHealth {
  engine?: 'sqlite-node' | 'cloudflare-d1';
  status: 'HEALTHY' | 'BACKUP_DUE' | 'FAILED' | 'VERIFICATION_REQUIRED' | 'RESTORE_TEST_REQUIRED';
  lastSuccessfulBackup: BackupRecord | null;
  lastAttemptedBackup: BackupRecord | null;
  nextScheduledBackupIso: string | null;
  nextScheduledBackupDisplay: string | null;
  autoBackupEnabled: boolean;
  totalValidBackups: number;
  totalStorageBytes: number;
  latestVerificationResult: string | null;
  lastRestoreTestResult: string | null;
  lastRestoreTestAt: string | null;
}

export interface BackupSettings {
  auto_backup_enabled: boolean;
  schedule_time_ist: string;
  retention_daily_count: number;
  retention_weekly_count: number;
  last_attempt_at?: string | null;
  last_success_at?: string | null;
  last_error_message?: string | null;
  last_restore_test_at?: string | null;
  last_restore_test_result?: string | null;
}

export interface DryRunRestoreReport {
  tested_at: string;
  backup_id: string;
  filename: string;
  integrity_status: string;
  foreign_keys_ok: boolean;
  store_name: string;
  table_count: number;
  sample_records: {
    products: number;
    sales: number;
    customers: number;
    purchases: number;
    financial_transactions: number;
    staff: number;
    audit_logs: number;
  };
  message: string;
}

export interface DataSafetyStatus {
  checkedAt: string;
  engine?: 'sqlite-node' | 'cloudflare-d1';
  database: {
    filename: string;
    filepath: string;
    sizeBytes: number;
    walSizeBytes: number;
    lastModifiedAt: string | null;
    totalTables: number;
    totalRecords: number;
  };
  litestream: {
    configured: boolean;
    gcsBucket: string | null;
    replicaPath: string | null;
    binaryInstalled: boolean;
    configPath: string | null;
    retention: string | null;
    processRunning: boolean;
    shadowDirPresent: boolean;
    shadowLastUpdatedAt: string | null;
    latestSnapshotAt: string | null;
    latestGeneration: string | null;
    status: 'REPLICATING' | 'DEGRADED' | 'STANDALONE_LOCAL' | 'D1_CLOUDFLARE';
    statusLabel: string;
    statusDetail: string;
  };
  backup: {
    healthStatus: 'HEALTHY' | 'BACKUP_DUE' | 'FAILED' | 'VERIFICATION_REQUIRED' | 'RESTORE_TEST_REQUIRED';
    lastSuccessfulBackupAt: string | null;
    lastSuccessfulBackup: {
      id: string;
      filename: string;
      backup_type: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE';
      file_size: number;
      verification_status: 'VERIFIED' | 'FAILED' | 'UNCHECKED';
      checksum_sha256: string;
      created_at: string;
    } | null;
    lastAttemptAt: string | null;
    lastErrorMessage: string | null;
    autoBackupEnabled: boolean;
    nextScheduledBackupDisplay: string;
    totalValidBackups: number;
    totalStorageBytes: number;
    lastRestoreTestAt: string | null;
    lastRestoreTestResult: string | null;
  };
}

