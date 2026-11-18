import React, { useState } from 'react';
import { Store, UserCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { api, setStoredToken } from '../services/api.ts';
import { User } from '../types.ts';

interface SetupScreenProps {
  onSetupSuccess: (user: User) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupSuccess }) => {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanFullName = fullName.trim();
    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanFullName) {
      setError('Please provide the owner full name.');
      return;
    }
    if (!cleanUsername) {
      setError('Please choose an administrator username.');
      return;
    }
    if (!cleanPassword) {
      setError('Please choose a secure administrator password.');
      return;
    }
    if (cleanPassword.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.setupOwner({
        store_name: 'New Bhama Fashions',
        store_location: 'Chilakaluripet, Andhra Pradesh',
        full_name: cleanFullName,
        username: cleanUsername,
        password: cleanPassword,
      });

      setStoredToken(res.token);
      onSetupSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Setup failed. Please check the fields and try again.');
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
          <h1 className="text-2xl font-bold tracking-tight text-[#1C1917]">
            New Bhama Fashions
          </h1>
          <p className="text-xs text-[#6F6962]">
            Initial Store Owner Setup
          </p>
        </div>

        {error && (
          <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-[#A34F4F] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#A34F4F]" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSetup} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              Full Name
            </label>
            <input
              type="text"
              required
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter owner full name"
              className="w-full px-3.5 py-2.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] placeholder-[#9A938B] text-sm focus:outline-none focus:border-[#A67C52] focus:ring-3 focus:ring-[#A67C52]/15 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              className="w-full px-3.5 py-2.5 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] placeholder-[#9A938B] text-sm focus:outline-none focus:border-[#A67C52] focus:ring-3 focus:ring-[#A67C52]/15 transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Set a password"
                className="w-full px-3.5 py-2.5 pr-10 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] placeholder-[#9A938B] text-sm focus:outline-none focus:border-[#A67C52] focus:ring-3 focus:ring-[#A67C52]/15 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9A938B] hover:text-[#1C1917] transition p-0.5"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] font-semibold rounded-lg shadow-sm transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
          >
            <UserCheck className="w-4 h-4 text-[#A67C52]" />
            {loading ? 'Creating Owner Account...' : 'Create Owner Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

