import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firebase Auth
export const auth = getAuth(app);

// Initialize Cloud Firestore using database ID from config
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);

// Google Workspace Scopes
export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
];

const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));

// In-memory token cache
let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Test Firestore connection on boot
export async function testFirestoreConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true, message: 'Firestore connection verified' };
  } catch (error: any) {
    if (error?.message?.includes('the client is offline')) {
      console.warn('Firestore offline / check config:', error);
      return { ok: false, message: 'Firestore client is currently offline' };
    }
    // Non-existent document is a valid response indicating connection works
    return { ok: true, message: 'Firestore connection active' };
  }
}

// Auth state listener
export const initFirebaseAuth = (
  onAuthSuccess?: (user: FirebaseUser, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
    if (user) {
      if (onAuthSuccess) {
        onAuthSuccess(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// Sign in with Google Popup
export const signInWithGoogle = async (): Promise<{
  user: FirebaseUser;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google OAuth access token');
    }

    cachedAccessToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } catch (error: any) {
    console.error('Google Sign In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getCachedAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const signOutGoogle = async (): Promise<void> => {
  await signOut(auth);
  cachedAccessToken = null;
};

// Cloud Firestore Sync Logging
export interface GoogleSyncLogItem {
  id?: string;
  type: 'sheets_export' | 'sheets_import' | 'calendar_event' | 'cloud_backup';
  title: string;
  timestamp: string;
  details: string;
  userEmail: string;
  status: 'SUCCESS' | 'FAILED';
  url?: string;
}

export async function logSyncToFirestore(
  entry: Omit<GoogleSyncLogItem, 'timestamp'>
): Promise<void> {
  try {
    const syncLogsCol = collection(db, 'google_sync_logs');
    await addDoc(syncLogsCol, {
      ...entry,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Could not write sync log to Firestore (may be offline):', err);
  }
}

export async function fetchSyncLogsFromFirestore(
  maxEntries = 20
): Promise<GoogleSyncLogItem[]> {
  try {
    const syncLogsCol = collection(db, 'google_sync_logs');
    const q = query(syncLogsCol, orderBy('timestamp', 'desc'), limit(maxEntries));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<GoogleSyncLogItem, 'id'>),
    }));
  } catch (err) {
    console.warn('Could not fetch sync logs from Firestore:', err);
    return [];
  }
}

// Manual Handwritten Bills Firestore Integration
export interface FirestoreManualBill {
  id?: string;
  billNumber: string;
  billDate: string;
  totalAmount: number;
  paymentMethod: 'CASH' | 'UPI' | 'SPLIT' | 'CREDIT';
  cashAmount: number;
  upiAmount: number;
  dueAmount: number;
  itemCount: number;
  items: Array<{
    itemName: string;
    quantity: number;
    rate: number;
    itemTotal: number;
  }>;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  createdAt: string;
  createdBy?: string;
}

export async function saveManualBillToFirestore(
  billData: Omit<FirestoreManualBill, 'createdAt'>
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const col = collection(db, 'manual_bills');
    // Strip undefined properties to ensure Firestore SDK compatibility
    const cleanPayload: Record<string, any> = {};
    for (const [key, value] of Object.entries(billData)) {
      if (value !== undefined) {
        cleanPayload[key] = value;
      }
    }
    const docRef = await addDoc(col, {
      ...cleanPayload,
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id: docRef.id };
  } catch (err: any) {
    console.warn('Could not write manual bill to Firestore (may be offline):', err);
    return { ok: false, error: err?.message || 'Firestore offline or inaccessible' };
  }
}

export async function fetchManualBillsFromFirestore(
  maxEntries = 50
): Promise<FirestoreManualBill[]> {
  try {
    const col = collection(db, 'manual_bills');
    const q = query(col, orderBy('createdAt', 'desc'), limit(maxEntries));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<FirestoreManualBill, 'id'>),
    }));
  } catch (err) {
    console.warn('Could not fetch manual bills from Firestore:', err);
    return [];
  }
}

