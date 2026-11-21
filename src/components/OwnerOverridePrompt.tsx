import React, { useEffect, useState } from 'react';
import { Lock, AlertTriangle, X, Eye, EyeOff, ShieldCheck } from 'lucide-react';

interface OwnerOverridePromptProps {
  isOpen: boolean;
  title?: string;
  description: string;
  requireReason?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  initialReason?: string;
  confirmLabel?: string;
  errorMessage?: string | null;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (ownerPassword: string, reason: string) => void | Promise<void>;
}

export const OwnerOverridePrompt: React.FC<OwnerOverridePromptProps> = ({
  isOpen,
  title = 'Owner Authorization Required',
  description,
  requireReason = true,
  reasonLabel = 'Audit Reason *',
  reasonPlaceholder = 'Enter clear business reason for this change...',
  initialReason = '',
  confirmLabel = 'Verify & Authorize',
  errorMessage = null,
  submitting = false,
  onCancel,
  onConfirm,
}) => {
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reason, setReason] = useState(initialReason);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setOwnerPassword('');
      setShowPassword(false);
      setReason(initialReason || '');
      setLocalError(null);
    } else {
      setOwnerPassword('');
    }
  }, [isOpen, initialReason]);

  if (!isOpen) return null;

  const displayError = localError || errorMessage;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (requireReason && !reason.trim()) {
      setLocalError('Please enter a mandatory audit reason.');
      return;
    }

    if (!ownerPassword) {
      setLocalError('Owner account password is required.');
      return;
    }

    const pwd = ownerPassword;
    setOwnerPassword('');
    await onConfirm(pwd, reason.trim());
  };

  return (
    <div
      className="fixed inset-0 bg-black/65 backdrop-blur-[2px] flex items-center justify-center p-4 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-override-title"
    >
      <div className="bg-[#FAF8F4] border border-[#D4CDC2] rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="bg-[#171513] px-5 py-4 text-[#F5F2EC] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-[#A67C52]/20 text-[#D4A778]">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 id="owner-override-title" className="font-bold text-sm tracking-wide">
                {title}
              </h3>
              <p className="text-[11px] text-[#9A938B]">
                Verified securely on server against Owner password
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-[#9A938B] hover:text-white transition p-1 rounded-lg"
            aria-label="Close authorization dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{description}</p>
          </div>

          {displayError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
              {displayError}
            </div>
          )}

          {requireReason && (
            <div>
              <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
                {reasonLabel}
              </label>
              <textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={reasonPlaceholder}
                required={requireReason}
                disabled={submitting}
                className="w-full px-3 py-2 text-xs bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-[#1C1917] mb-1.5">
              Store Owner Password *
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="Enter Owner account password (not PIN)"
                autoComplete="current-password"
                autoFocus
                required
                disabled={submitting}
                className="w-full pl-3 pr-10 py-2.5 text-sm bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6F6962] hover:text-[#1C1917] p-1"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-[#6F6962] mt-1">
              Staff PIN is not accepted. Authorizes this single action only.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-[#6F6962] hover:text-[#1C1917] border border-[#D4CDC2] rounded-xl transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#D4A778]" />
              {submitting ? 'Verifying...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
