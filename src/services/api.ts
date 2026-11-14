import { User, BackupRecord, BackupHealth, BackupSettings, DryRunRestoreReport } from '../types.ts';

const BASE_URL = '/api';

export function getStoredToken(): string | null {
  return localStorage.getItem('nbf_auth_token');
}

export function setStoredToken(token: string): void {
  localStorage.setItem('nbf_auth_token', token);
}

export function clearStoredToken(): void {
  localStorage.removeItem('nbf_auth_token');
}

export const removeStoredToken = clearStoredToken;

async function request<T>(endpoint: string, options: RequestInit = {}, retries = 1): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${endpoint}`, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
  } catch (netErr: any) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 600));
      return request<T>(endpoint, options, retries - 1);
    }
    throw new Error(netErr.message || 'Network connection failed. Please check your connection.');
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!res.ok) {
    let errorMsg = `Server error (${res.status})`;
    if (isJson) {
      try {
        const errorJson = await res.json();
        errorMsg = errorJson.error || errorMsg;
      } catch {
        errorMsg = res.statusText || errorMsg;
      }
    } else {
      if (res.status === 401) {
        clearStoredToken();
        errorMsg = 'Session expired. Please log in again.';
      } else {
        errorMsg = res.statusText ? `Server returned ${res.status}: ${res.statusText}` : `Server returned error (${res.status})`;
      }
    }

    if (res.status === 401) {
      clearStoredToken();
    }

    throw new Error(errorMsg);
  }

  if (!isJson) {
    // If the server returned an HTML page (e.g. during server reload or proxy gateway sync), retry once
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 600));
      return request<T>(endpoint, options, retries - 1);
    }
    throw new Error('Server returned an unexpected non-JSON response. Please retry.');
  }

  try {
    return await res.json();
  } catch {
    throw new Error('Failed to parse server JSON response.');
  }
}

export const api = {
  // Auth
  getAuthStatus: () => request<{
    initialized: boolean;
    storeName: string;
    storeLocation: string;
    storeTagline: string;
    contactPhone1: string;
    contactPhone2: string;
    contactPhone3: string;
    owner?: User;
    owners: User[];
  }>('/auth/status'),
  getSetupStatus: async () => {
    const res = await request<any>('/auth/status');
    return { setup_required: !res.initialized, ...res };
  },
  setupOwner: (data: any) => request<{ success: boolean; token: string; user: User; contacts?: any }>('/auth/setup', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  login: (data: any) => request<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  logout: () => {
    clearStoredToken();
    return request<{ success: boolean; message: string }>('/auth/logout', { method: 'POST' });
  },
  getMe: () => request<{ user: User }>('/auth/me'),
  getUsers: () => request<{ users: User[] }>('/auth/users'),
  createUser: (data: any) => request<{ success: boolean; user: User }>('/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateUser: (id: string, data: any) => request<{ success: boolean; message: string }>(`/auth/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  deleteUser: (id: string) => request<{ success: boolean; message: string }>(`/auth/users/${id}`, {
    method: 'DELETE',
  }),
  getStoreProfile: () => request<{
    store_name: string;
    store_location: string;
    store_tagline: string;
    contact_phone_1: string;
    contact_phone_2: string;
    contact_phone_3: string;
    owner?: User;
    owners: User[];
  }>('/auth/store-profile'),
  updateStoreProfile: (data: any) => request<{ success: boolean; message: string }>('/auth/store-profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),

  // Dashboard
  getDashboard: (date?: string) =>
    request<any>(`/dashboard${date ? `?date=${encodeURIComponent(date)}` : ''}`),

  // Products & Categories
  getCategories: () => request<{ categories: any[] }>('/products/categories'),
  createCategory: (data: any) => request<{ success: boolean; id: string }>('/products/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getBrands: () => request<{ brands: any[] }>('/products/brands'),
  createBrand: (data: any) => request<{ success: boolean; id: string }>('/products/brands', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getProducts: (params?: { search?: string; category_id?: string; active_only?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category_id) query.set('category_id', params.category_id);
    if (params?.active_only) query.set('active_only', 'true');
    return request<{ products: any[] }>(`/products?${query.toString()}`);
  },
  getProduct: (id: string) => request<{ product: any }>(`/products/${id}`),
  createProduct: (data: any) => request<{ success: boolean; id: string }>('/products', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateProduct: (id: string, data: any) => request<{ success: boolean }>(`/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),

  // Inventory & Stock
  getStock: (params?: { search?: string; category_id?: string }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.category_id) query.set('category_id', params.category_id);
    return request<{ stock: any[] }>(`/inventory/stock?${query.toString()}`);
  },
  getStockLedger: (params?: { product_id?: string; movement_type?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.product_id) query.set('product_id', params.product_id);
    if (params?.movement_type) query.set('movement_type', params.movement_type);
    if (params?.limit) query.set('limit', String(params.limit));
    return request<{ ledger: any[] }>(`/inventory/ledger?${query.toString()}`);
  },
  getBatches: (productId?: string) => {
    const query = productId ? `?product_id=${productId}` : '';
    return request<{ batches: any[] }>(`/inventory/batches${query}`);
  },
  adjustStock: (data: any) => request<{ success: boolean }>('/inventory/adjust', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // POS
  posSearch: (query: string) => request<{ products: any[] }>(`/pos/search?query=${encodeURIComponent(query)}`),
  posScan: (code: string) => request<any>(`/pos/scan/${encodeURIComponent(code)}`),
  posCheckout: (data: any) => request<{ success: boolean; sale: any }>('/pos/checkout', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getRecentSales: () => request<{ sales: any[] }>('/pos/recent'),
  getBills: (params?: { search?: string; date?: string; start_date?: string; end_date?: string; status?: string; channel?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.date) query.set('date', params.date);
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.status) query.set('status', params.status);
    if (params?.channel) query.set('channel', params.channel);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    return request<{ bills: any[] }>(`/pos/bills?${query.toString()}`);
  },
  getDailyBills: (params?: { search?: string; date?: string; start_date?: string; end_date?: string; status?: string; limit?: number; offset?: number }) => {
    return api.getBills({ ...params, channel: 'MANUAL' });
  },
  getBillDetail: (id: string) => request<{ sale: any; items: any[]; returns: any[]; customerDue?: any }>(`/pos/bills/${id}`),
  cancelBill: (id: string, data: { reason: string; notes?: string }) => request<{ success: boolean; message: string; sale: any }>(`/pos/bills/${id}/cancel`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  returnBillItems: (id: string, data: { items: { sale_item_id: string; quantity: number }[]; refund_method: string; reason: string; notes?: string }) => request<{ success: boolean; return_record: any }>(`/pos/bills/${id}/return`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  createManualBill: (data: any) => request<{ success: boolean; message: string; sale: any }>('/pos/manual-bill', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  checkBillNumber: (params: { billNumber: string; date?: string }) => {
    const query = new URLSearchParams();
    if (params.billNumber) query.set('billNumber', params.billNumber);
    if (params.date) query.set('date', params.date);
    return request<{ exists: boolean; bill: any | null; message: string }>(`/pos/check-bill-number?${query.toString()}`);
  },

  // Purchases & Suppliers
  getSuppliers: () => request<{ suppliers: any[] }>('/purchases/suppliers'),
  createSupplier: (data: any) => request<{ success: boolean; id: string }>('/purchases/suppliers', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getPurchases: (params?: { supplier_id?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.supplier_id) query.set('supplier_id', params.supplier_id);
    if (params?.status) query.set('status', params.status);
    return request<{ purchases: any[] }>(`/purchases?${query.toString()}`);
  },
  getPurchase: (id: string) => request<{ purchase: any }>(`/purchases/${id}`),
  createPurchase: (data: any) => request<{ success: boolean; id: string }>('/purchases', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  paySupplierDue: (id: string, data: any) => request<{ success: boolean; balance_due: number }>(`/purchases/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // Money & Accounts
  getAccounts: () => request<{ accounts: { cash: number; upi: number; bank: number | null } }>('/money/accounts'),
  getTransactions: (params?: { start_date?: string; end_date?: string; type?: string; account?: string }) => {
    const query = new URLSearchParams();
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    if (params?.type) query.set('type', params.type);
    if (params?.account) query.set('account', params.account);
    return request<{ transactions: any[] }>(`/money/transactions?${query.toString()}`);
  },
  createTransaction: (data: any) => request<{ success: boolean; id: string }>('/money/transactions', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateTransaction: (id: string, data: any) => request<{ success: boolean }>(`/money/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  correctTransaction: (id: string, data: any) => request<{ success: boolean; difference: number }>(`/money/transactions/${id}/correct`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getProfitLoss: (params?: { start_date?: string; end_date?: string }) => {
    const query = new URLSearchParams();
    if (params?.start_date) query.set('start_date', params.start_date);
    if (params?.end_date) query.set('end_date', params.end_date);
    return request<any>(`/money/profit-loss?${query.toString()}`);
  },

  // Customer Dues
  getCustomers: (params?: { search?: string; pending_only?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.pending_only) query.set('pending_only', 'true');
    return request<{ customers: any[] }>(`/dues/customers?${query.toString()}`);
  },
  createCustomer: (data: any) => request<{ success: boolean; id: string }>('/dues/customers', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getCustomerDues: (params?: { customer_id?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.customer_id) query.set('customer_id', params.customer_id);
    if (params?.status) query.set('status', params.status);
    return request<{ dues: any[] }>(`/dues?${query.toString()}`);
  },
  getCustomerDueDetail: (id: string) => request<{ due: any }>(`/dues/${id}`),
  payCustomerDue: (id: string, data: any) => request<{ success: boolean; balance_due: number; status: string }>(`/dues/${id}/pay`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getCustomerLedger: (id: string) => request<{
    customer: any;
    dues: any[];
    payments: any[];
    timeline: any[];
    total_pending: number;
  }>(`/dues/customers/${id}/ledger`),

  // Staff & Attendance
  getStaff: () => request<{ staff: any[] }>('/staff'),
  createStaff: (data: any) => request<{ success: boolean; id: string }>('/staff', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getAttendance: (params?: { date?: string; month?: number; year?: number }) => {
    const query = new URLSearchParams();
    if (params?.date) query.set('date', params.date);
    if (params?.month) query.set('month', String(params.month));
    if (params?.year) query.set('year', String(params.year));
    return request<{ attendance: any[] }>(`/staff/attendance?${query.toString()}`);
  },
  markAttendance: (data: any) => request<{ success: boolean }>('/staff/attendance', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  payStaffSalary: (data: any) => request<{ success: boolean; id: string }>('/staff/salary-payment', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getSalaryPayments: (staffId?: string) => {
    const query = staffId ? `?staff_id=${staffId}` : '';
    return request<{ payments: any[] }>(`/staff/salary-payments${query}`);
  },

  // Daily Closing
  calculateDailyClosing: (date?: string) => {
    const query = date ? `?date=${date}` : '';
    return request<any>(`/closing/calculate${query}`);
  },
  getDayClosingSummary: async (date?: string) => {
    const query = date ? `?date=${date}` : '';
    const res = await request<any>(`/closing/calculate${query}`);
    const auto = res.autoCalculations || {};
    return {
      isClosed: res.existingRecord?.status === 'CLOSED',
      closingRecord: res.existingRecord,
      salesBreakdown: {
        totalSales: (auto.cashSales || 0) + (auto.upiSales || 0),
        cashSales: auto.cashSales || 0,
        upiSales: auto.upiSales || 0,
        dueSales: 0,
      },
      openingCash: auto.openingCash || 0,
      duesCollectedCash: auto.cashReceivedOther || 0,
      dayExpensesCash: auto.cashExpenses || 0,
      otherCashOutflow: auto.cashPaidOther || 0,
      systemExpectedCash: auto.expectedClosingCash || 0,
      systemExpectedUpi: auto.upiSales || 0,
    };
  },
  submitDailyClosing: (data: any) => request<any>('/closing/submit', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  closeDay: async (data: any) => {
    return request<any>('/closing/submit', {
      method: 'POST',
      body: JSON.stringify({
        closing_date: data.date,
        opening_cash: data.opening_cash || 0,
        actual_counted_cash: data.actual_cash_counted,
        closing_notes: data.closing_notes,
        finalize: true,
      }),
    });
  },
  getDailyClosingHistory: () => request<{ closings: any[] }>('/closing/history'),
  getDailyClosings: () => request<{ closings: any[] }>('/closing/history'),

  // Assets & Loans
  getAssets: () => request<{ assets: any[] }>('/assets-loans/assets'),
  createAsset: (data: any) => request<{ success: boolean; id: string }>('/assets-loans/assets', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  disposeAsset: (id: string, data: any) => request<{ success: boolean; profit_or_loss: number }>(`/assets-loans/assets/${id}/dispose`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  getLoans: () => request<{ loans: any[] }>('/assets-loans/loans'),
  createLoan: (data: any) => request<{ success: boolean; id: string }>('/assets-loans/loans', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  repayLoan: (id: string, data: any) => request<{ success: boolean; outstanding_balance: number; status: string }>(`/assets-loans/loans/${id}/repay`, {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  // Audit Logs
  getAuditLogs: (params?: { entity_type?: string; action?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.entity_type) query.set('entity_type', params.entity_type);
    if (params?.action) query.set('action', params.action);
    if (params?.limit) query.set('limit', String(params.limit));
    return request<{ logs: any[] }>(`/audit?${query.toString()}`);
  },

  // Excel Exports (trigger download directly)
  downloadExport: async (type: string, params?: { startDate?: string; endDate?: string }) => {
    const token = getStoredToken();
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    const url = `${BASE_URL}/export/${type}?${query.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      }
    });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `NBF_${type}_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  },
  downloadExcel: (type: string) => {
    const token = getStoredToken();
    const url = `${BASE_URL}/export/${type}`;
    fetch(url, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
      }
    })
      .then((res) => {
        if (!res.ok) throw new Error('Export failed');
        return res.blob();
      })
      .then((blob) => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `NBF_${type}_${Date.now()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
      })
      .catch((err) => alert(err.message));
  },

  // Database Backup & Restore API
  getBackupHealth: () => request<BackupHealth>('/backup/health'),
  getBackupHistory: () => request<{ history: BackupRecord[] }>('/backup/history'),
  getBackupSettings: () => request<{ settings: BackupSettings }>('/backup/settings'),
  updateBackupSettings: (data: Partial<BackupSettings>) =>
    request<{ success: boolean; settings: BackupSettings }>('/backup/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  createManualBackup: (notes?: string) =>
    request<{ success: boolean; backup: BackupRecord }>('/backup/create', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),
  verifyBackup: (id: string) =>
    request<{ success: boolean; details: string }>(`/backup/verify/${id}`, {
      method: 'POST',
    }),
  testRestoreBackup: (id: string) =>
    request<{ success: boolean; report: DryRunRestoreReport }>(`/backup/test-restore/${id}`, {
      method: 'POST',
    }),
  restoreBackup: (id: string) =>
    request<{ success: boolean; message: string; preRestoreBackupId: string; restoredSummary: any }>(
      `/backup/restore/${id}`,
      {
        method: 'POST',
      }
    ),
  uploadRestoreBackup: (filename: string, fileData: string) =>
    request<{ success: boolean; message: string; preRestoreBackupId: string; restoredSummary: any }>(
      '/backup/upload-restore',
      {
        method: 'POST',
        body: JSON.stringify({ filename, fileData }),
      }
    ),
  toggleBackupLock: (id: string) =>
    request<{ success: boolean; is_locked: boolean }>(`/backup/toggle-lock/${id}`, {
      method: 'POST',
    }),
  deleteBackup: (id: string) =>
    request<{ success: boolean; message: string }>(`/backup/${id}`, {
      method: 'DELETE',
    }),
  getLiveDatabaseInfo: () =>
    request<{
      filename: string;
      sizeBytes: number;
      totalTables: number;
      totalRecords: number;
      tableCounts: Record<string, number>;
    }>('/backup/live-info'),
  downloadLiveDatabase: async (): Promise<{
    filename: string;
    sizeBytes: number;
    checksum: string | null;
  }> => {
    const token = getStoredToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${BASE_URL}/backup/download-live`, {
      credentials: 'same-origin',
      headers,
    });

    if (!res.ok) {
      let errMsg = `Download failed (${res.status})`;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          const errJson = await res.json();
          errMsg = errJson.error || errMsg;
        } catch {}
      }
      throw new Error(errMsg);
    }

    const disposition = res.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
    const filename = filenameMatch?.[1] || `nbf_live_database_${Date.now()}.sqlite`;
    const checksum = res.headers.get('x-backup-checksum');
    const headerSize = Number(res.headers.get('x-database-size') || 0);

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);

    return {
      filename,
      sizeBytes: headerSize || blob.size,
      checksum,
    };
  },
  downloadBackupFile: (id: string, filename: string) => {
    const token = getStoredToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const url = `${BASE_URL}/backup/download/${id}`;
    fetch(url, {
      credentials: 'same-origin',
      headers,
    })
      .then((res) => {
        if (!res.ok) throw new Error('Download failed: ' + res.statusText);
        return res.blob();
      })
      .then((blob) => {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = filename || `nbf_backup_${Date.now()}.sqlite`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
      })
      .catch((err) => console.error('Backup download error:', err.message));
  },

  // Sales Trends & Visualization
  getSalesTrends: (params?: { startDate?: string; endDate?: string }) => {
    const query = new URLSearchParams();
    if (params?.startDate) query.set('startDate', params.startDate);
    if (params?.endDate) query.set('endDate', params.endDate);
    return request<{
      success: boolean;
      hasRealData: boolean;
      summary: {
        totalRevenue: number;
        netRevenue: number;
        totalRefunds: number;
        totalBills: number;
        avgOrderValue: number;
        cashTotal: number;
        upiTotal: number;
        creditTotal: number;
        cashPercent: number;
        upiPercent: number;
        creditPercent: number;
        peakDay: { date: string; label: string; revenue: number; billsCount: number } | null;
        peakWeek: { weekKey: string; label: string; revenue: number } | null;
        peakMonth: { monthKey: string; label: string; revenue: number } | null;
      };
      daily: Array<{
        date: string;
        label: string;
        revenue: number;
        netRevenue: number;
        billsCount: number;
        cashSales: number;
        upiSales: number;
        creditSales: number;
        avgOrderValue: number;
        returnsCount?: number;
        refundAmount?: number;
      }>;
      weekly: Array<{
        weekKey: string;
        label: string;
        revenue: number;
        billsCount: number;
        cashSales: number;
        upiSales: number;
        creditSales: number;
        avgOrderValue: number;
      }>;
      monthly: Array<{
        monthKey: string;
        label: string;
        revenue: number;
        billsCount: number;
        cashSales: number;
        upiSales: number;
        creditSales: number;
        avgOrderValue: number;
      }>;
      topProducts: Array<{
        product_name: string;
        total_qty: number;
        total_revenue: number;
      }>;
      insights: string[];
    }>(`/reports/sales-trends?${query.toString()}`);
  },
};
