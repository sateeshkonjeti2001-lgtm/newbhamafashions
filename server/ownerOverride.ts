import { dbQueryAll } from './db.ts';
import { checkPassword } from './auth.ts';

export interface VerifiedOwner {
  id: string;
  username: string;
  full_name: string;
}

export interface OwnerOverrideResult {
  ok: boolean;
  owner?: VerifiedOwner;
  status: number;
  code?: 'OWNER_PASSWORD_REQUIRED' | 'INVALID_OWNER_PASSWORD' | 'NO_ACTIVE_OWNER';
  error?: string;
}

/**
 * Verifies the actual active OWNER account password securely on the server.
 * Never falls back to PIN or hardcoded values, and never logs the supplied password.
 */
export async function verifyOwnerPasswordOverride(
  ownerPassword: unknown,
  requiredMessage: string = 'Owner password verification is required for this protected action.'
): Promise<OwnerOverrideResult> {
  if (typeof ownerPassword !== 'string' || ownerPassword.length === 0) {
    return {
      ok: false,
      status: 403,
      code: 'OWNER_PASSWORD_REQUIRED',
      error: requiredMessage,
    };
  }

  const owners = await dbQueryAll<{
    id: string;
    username: string;
    full_name: string;
    password_hash: string;
  }>("SELECT id, username, full_name, password_hash FROM users WHERE role = 'OWNER' AND is_active = 1");

  if (!owners || owners.length === 0) {
    return {
      ok: false,
      status: 403,
      code: 'NO_ACTIVE_OWNER',
      error: 'No active Owner account is configured in the store system.',
    };
  }

  for (const owner of owners) {
    if (owner.password_hash && (await checkPassword(ownerPassword, owner.password_hash))) {
      return {
        ok: true,
        status: 200,
        owner: {
          id: owner.id,
          username: owner.username,
          full_name: owner.full_name || owner.username || 'Owner',
        },
      };
    }
  }

  return {
    ok: false,
    status: 403,
    code: 'INVALID_OWNER_PASSWORD',
    error: 'Invalid Owner password. Authorization denied.',
  };
}
