import React, { useState } from 'react';
import { Store, LogIn, AlertCircle } from 'lucide-react';
import { api, setStoredToken } from '../services/api.ts';
import { User } from '../types.ts';

interface LoginScreenProps {
  onLoginSuccess: (user: User) => void;
  storeName?: string;
  storeLocation?: string;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLoginSuccess,
  storeName = 'New Bhama Fashions',
  storeLocation = 'Chilakaluripet, Andhra Pradesh'
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.login({
        username: username.trim(),
        password: password.trim()
      });

      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F2EC] text-[#1C1917] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white border border-[#E3DED5] rounded-2xl shadow-[0_4px_24px_rgba(23,21,19,0.06)] p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex p-3.5 rounded-2xl bg-[#171513] text-[#A67C52] shadow-sm mb-2">
            <Store className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1C1917]">{storeName}</h1>
          <p className="text-xs text-[#6F6962]">Offline Physical Retail POS &amp; ERP</p>
          <div className="text-xs text-[#A67C52] font-semibold bg-[#FAF8F4] py-1 px-3.5 rounded-full inline-block border border-[#E3DED5]">
            {storeLocation}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-[#A34F4F] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#A34F4F]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="w-full px-3.5 py-2.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] placeholder-[#9A938B] text-sm focus:outline-none focus:border-[#A67C52] focus:ring-3 focus:ring-[#A67C52]/15 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full px-3.5 py-2.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] placeholder-[#9A938B] text-sm focus:outline-none focus:border-[#A67C52] focus:ring-3 focus:ring-[#A67C52]/15 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] font-semibold rounded-lg shadow-sm transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
          >
            <LogIn className="w-4 h-4 text-[#A67C52]" />
            {loading ? 'Authenticating...' : 'Sign In to ERP'}
          </button>
        </form>

        <div className="pt-2 border-t border-[#E3DED5] text-center text-xs text-[#6F6962]">
          Roles: <span className="text-[#1C1917] font-semibold">Store Owner</span> (Full Control) &amp; <span className="text-[#1C1917] font-semibold">Billing Cashier</span> (POS, Billing, Day Count)
        </div>
      </div>
    </div>
  );
};
