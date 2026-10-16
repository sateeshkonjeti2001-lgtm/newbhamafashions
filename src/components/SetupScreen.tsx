import React, { useState } from 'react';
import {
  Shield,
  Store,
  UserCheck,
  AlertCircle,
  Eye,
  EyeOff,
  PhoneCall,
  CheckCircle2,
  Lock,
  User as UserIcon,
  MapPin,
} from 'lucide-react';
import { api, setStoredToken } from '../services/api.ts';
import { User } from '../types.ts';

interface SetupScreenProps {
  onSetupSuccess: (user: User) => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onSetupSuccess }) => {
  // Store details
  const [storeName, setStoreName] = useState('New Bhama Fashions');
  const [storeLocation, setStoreLocation] = useState('Chilakaluripet, Andhra Pradesh');

  // Single Store Owner / Administrator credentials
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState('');

  // Optional Official Shop Contact
  const [shopPhone, setShopPhone] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePhoneChange = (val: string) => {
    setPhone(val);
    // If shop phone is empty or matches phone, pre-fill it for convenience
    if (!shopPhone || shopPhone === phone) {
      setShopPhone(val);
    }
  };

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
        store_name: storeName.trim() || 'New Bhama Fashions',
        store_location: storeLocation.trim() || 'Chilakaluripet, Andhra Pradesh',
        full_name: cleanFullName,
        username: cleanUsername,
        password: cleanPassword,
        phone: phone.trim() || undefined,
        contact_phone_1: shopPhone.trim() || phone.trim() || undefined,
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
    <div className="min-h-screen bg-[#F5F2EC] text-[#1C1917] flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="max-w-xl w-full bg-white border border-[#E3DED5] rounded-2xl shadow-[0_4px_24px_rgba(23,21,19,0.06)] p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2 pb-2 border-b border-[#E3DED5]">
          <div className="inline-flex p-3 rounded-2xl bg-[#171513] text-[#A67C52] shadow-sm mb-1">
            <Store className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1C1917]">
            {storeName}
          </h1>
          <p className="text-xs sm:text-sm text-[#6F6962]">
            Offline Physical Retail ERP &bull; Store Owner Setup Wizard
          </p>
          <div className="text-xs text-[#A67C52] font-semibold bg-[#FAF8F4] py-1 px-3.5 rounded-full inline-flex items-center gap-1.5 border border-[#E3DED5]">
            <MapPin className="w-3.5 h-3.5" />
            <span>{storeLocation}</span>
          </div>
        </div>

        {/* Informational Banner */}
        <div className="bg-[#FAF8F4] p-4 rounded-xl border border-[#E3DED5] text-xs text-[#1C1917] flex items-start gap-3">
          <Shield className="w-5 h-5 text-[#3F6B50] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-[#1C1917]">
              Initial Store Administrator Setup
            </p>
            <p className="text-[#6F6962] leading-relaxed">
              Create the single master Owner account for New Bhama Fashions. This account holds full master administrative control over POS billing, FIFO inventory batches, accounting, day-end register, and staff permissions.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-[#A34F4F] text-xs flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#A34F4F]" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <form onSubmit={handleSetup} className="space-y-5">
          {/* Store Details Section */}
          <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-[#E3DED5]">
              <Store className="w-4 h-4 text-[#A67C52]" />
              <h3 className="font-bold text-xs uppercase tracking-wider text-[#1C1917]">
                Store Identity
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Store Name
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="New Bhama Fashions"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs font-medium focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Location / City
                </label>
                <input
                  type="text"
                  required
                  value={storeLocation}
                  onChange={(e) => setStoreLocation(e.target.value)}
                  placeholder="Chilakaluripet, Andhra Pradesh"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs font-medium focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
                />
              </div>
            </div>
          </div>

          {/* Owner Account Card */}
          <div className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#171513] text-[#F5F2EC] flex items-center justify-center font-bold text-xs">
                  <UserIcon className="w-4 h-4 text-[#A67C52]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1C1917]">Store Owner Account</h3>
                  <p className="text-[11px] text-[#6F6962]">Single Administrator with Full Master Control</p>
                </div>
              </div>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#EBF7EE] text-[#1E6B37] border border-[#BDE5C8]">
                Master Admin
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                Owner Full Name *
              </label>
              <input
                type="text"
                required
                autoFocus
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Sateesh Konjeti"
                className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#1C1917] mb-1">
                  Login Username *
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin or your name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#1C1917] mb-1">
                  Login Password *
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Set secure password"
                    className="w-full px-3 py-2 pr-9 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9A938B] hover:text-[#1C1917] transition p-0.5"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Owner Mobile Number (Optional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
                />
                <span className="text-[10px] text-[#9A938B] block mt-1">For account recovery &amp; staff records</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#1C1917] mb-1">
                  Official Shop Phone (Optional)
                </label>
                <input
                  type="tel"
                  value={shopPhone}
                  onChange={(e) => setShopPhone(e.target.value)}
                  placeholder="e.g. Counter Phone / Landline"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-lg text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52] focus:ring-2 focus:ring-[#A67C52]/20"
                />
                <span className="text-[10px] text-[#9A938B] block mt-1">Printed on thermal receipts (can update in Settings)</span>
              </div>
            </div>
          </div>

          {/* Submission button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] font-semibold rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
          >
            <UserCheck className="w-4 h-4 text-[#A67C52]" />
            {loading
              ? 'Initializing New Bhama Fashions...'
              : 'Complete Setup & Launch ERP System'}
          </button>
        </form>

        <div className="text-center text-[11px] text-[#9A938B] pt-2 border-t border-[#E3DED5]">
          New Bhama Fashions Offline ERP &bull; Local SQLite Storage &bull; Chilakaluripet, AP
        </div>
      </div>
    </div>
  );
};
