import React, { useState, useEffect } from 'react';
import {
  UserCheck,
  Plus,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  X,
  Shield,
  PhoneCall,
  Edit3,
  UserPlus,
  Store,
  Check,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { StaffMember, AttendanceRecord, UserRole, User } from '../types.ts';
import { getTodayIST, formatDateIST } from '../utils/date.ts';
import { OwnerOverridePrompt } from './OwnerOverridePrompt.tsx';

interface StaffViewProps {
  role: UserRole;
}

export const StaffView: React.FC<StaffViewProps> = ({ role }) => {
  const [activeTab, setActiveTab] = useState<'ATTENDANCE' | 'ROSTER' | 'PAYMENTS' | 'OWNERS_CONTACTS'>('ATTENDANCE');
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState(getTodayIST());
  const [loading, setLoading] = useState(true);
  const [pageBanner, setPageBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New Staff Modal
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [roleTitle, setRoleTitle] = useState('Sales Assistant');
  const [salary, setSalary] = useState<number | ''>('');
  const [joiningDate, setJoiningDate] = useState(getTodayIST());
  const [address, setAddress] = useState('');

  // Attendance Edit/Delete Reason Modal
  const [attModal, setAttModal] = useState<{
    mode: 'EDIT' | 'DELETE';
    staffId: string;
    staffName: string;
    attendanceId?: string;
    status?: string;
  } | null>(null);
  const [attReason, setAttReason] = useState('');
  const [attModalError, setAttModalError] = useState<string | null>(null);

  // Salary Payment Modal
  const [showPayModal, setShowPayModal] = useState(false);
  const [payStaffId, setPayStaffId] = useState('');
  const [payType, setPayType] = useState<'SALARY' | 'ADVANCE'>('SALARY');
  const [payAmount, setPayAmount] = useState<number | ''>('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [payNotes, setPayNotes] = useState('');

  // Reverse Salary Payment Modal
  const [reverseSalaryTarget, setReverseSalaryTarget] = useState<any | null>(null);
  const [reverseSalaryReason, setReverseSalaryReason] = useState('');
  const [reverseSalaryError, setReverseSalaryError] = useState<string | null>(null);

  // Owners & Contacts Management State
  const [systemUsers, setSystemUsers] = useState<User[]>([]);
  const [storeNameVal, setStoreNameVal] = useState('New Bhama Fashions');
  const [storeLocVal, setStoreLocVal] = useState('Chilakaluripet, Andhra Pradesh');
  const [storeTagVal, setStoreTagVal] = useState('Ladies Fashion Retail');
  const [contact1Val, setContact1Val] = useState('');
  const [contact2Val, setContact2Val] = useState('');
  const [contact3Val, setContact3Val] = useState('');
  const [savingContacts, setSavingContacts] = useState(false);
  const [contactsSuccess, setContactsSuccess] = useState<string | null>(null);

  // Create User Modal (Add Owner / Cashier)
  const [showUserModal, setShowUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'OWNER' | 'CASHIER'>('OWNER');
  const [newUserPhone, setNewUserPhone] = useState('');

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState<'OWNER' | 'CASHIER'>('OWNER');
  const [editPassword, setEditPassword] = useState('');
  const [editActive, setEditActive] = useState(true);

  // Owner Override Prompt
  const [overridePrompt, setOverridePrompt] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: (ownerPassword: string) => Promise<void>;
  } | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isOwner = role === 'OWNER';

  const loadData = async () => {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        api.getStaff(),
        api.getAttendance({ date: selectedDate }),
      ]);
      setStaffList(sRes.staff || []);
      setAttendance(aRes.attendance || []);

      if (isOwner) {
        const [pRes, uRes, profRes] = await Promise.all([
          api.getSalaryPayments().catch(() => ({ payments: [] })),
          api.getUsers().catch(() => ({ users: [] })),
          api.getStoreProfile().catch(() => null),
        ]);
        setPayments(pRes.payments || []);
        setSystemUsers(uRes.users || []);
        if (profRes) {
          setStoreNameVal(profRes.store_name || 'New Bhama Fashions');
          setStoreLocVal(profRes.store_location || 'Chilakaluripet, Andhra Pradesh');
          setStoreTagVal(profRes.store_tagline || 'Ladies Fashion Retail');
          setContact1Val(profRes.contact_phone_1 || '');
          setContact2Val(profRes.contact_phone_2 || '');
          setContact3Val(profRes.contact_phone_3 || '');
        }
      }
    } catch (err: any) {
      console.error('Error loading staff data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const showSuccess = (text: string) => {
    setPageBanner({ type: 'success', text });
    setTimeout(() => setPageBanner((prev) => (prev?.text === text ? null : prev)), 5000);
  };

  const submitAttendance = async (staffId: string, status: string, reason?: string, ownerPassword?: string) => {
    await api.markAttendance({
      staff_id: staffId,
      date: selectedDate,
      status,
      ...(reason ? { reason } : {}),
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });
    setAttModal(null);
    setOverridePrompt(null);
    showSuccess(`Attendance saved for ${selectedDate}.`);
    await loadData();
  };

  const handleMarkAttendance = async (staffMember: StaffMember, status: string, existingRecord?: AttendanceRecord) => {
    setPageBanner(null);
    if (existingRecord && selectedDate !== getTodayIST()) {
      setAttModal({
        mode: 'EDIT',
        staffId: staffMember.id,
        staffName: staffMember.name,
        status,
      });
      setAttReason('');
      setAttModalError(null);
      return;
    }

    try {
      await submitAttendance(staffMember.id, status);
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || `Business day ${selectedDate} is CLOSED. Enter Store Owner password to mark attendance.`,
          confirmLabel: 'Verify & Save Attendance',
          onConfirm: async (pwd) => {
            await submitAttendance(staffMember.id, status, 'Closed-day attendance update', pwd);
          },
        });
      } else if (String(err.message || '').toLowerCase().includes('reason')) {
        setAttModal({
          mode: 'EDIT',
          staffId: staffMember.id,
          staffName: staffMember.name,
          status,
        });
        setAttReason('');
        setAttModalError(err.message);
      } else {
        setPageBanner({ type: 'error', text: err.message || 'Failed to mark attendance' });
      }
    }
  };

  const submitDeleteAttendance = async (attendanceId: string, reasonText: string, ownerPassword?: string) => {
    await api.deleteAttendance(attendanceId, {
      reason: reasonText,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });
    setAttModal(null);
    setOverridePrompt(null);
    showSuccess('Attendance record removed.');
    await loadData();
  };

  const handleConfirmAttModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attModal) return;
    if (!attReason.trim()) {
      setAttModalError('Mandatory reason is required.');
      return;
    }

    setSubmitting(true);
    setAttModalError(null);
    try {
      if (attModal.mode === 'EDIT' && attModal.status) {
        await submitAttendance(attModal.staffId, attModal.status, attReason.trim());
      } else if (attModal.mode === 'DELETE' && attModal.attendanceId) {
        await submitDeleteAttendance(attModal.attendanceId, attReason.trim());
      }
    } catch (err: any) {
      if (err?.requires_owner_password) {
        const snapshot = { ...attModal };
        const savedReason = attReason.trim();
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || `Business day ${selectedDate} is CLOSED. Verify Store Owner password to confirm.`,
          confirmLabel: snapshot.mode === 'DELETE' ? 'Verify & Remove Attendance' : 'Verify & Update Attendance',
          onConfirm: async (pwd) => {
            if (snapshot.mode === 'EDIT' && snapshot.status) {
              await submitAttendance(snapshot.staffId, snapshot.status, savedReason, pwd);
            } else if (snapshot.mode === 'DELETE' && snapshot.attendanceId) {
              await submitDeleteAttendance(snapshot.attendanceId, savedReason, pwd);
            }
          },
        });
      } else {
        setAttModalError(err.message || 'Failed to update attendance');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !roleTitle.trim()) {
      setFormError('Staff name and role title are required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await api.createStaff({
        name: name.trim(),
        phone: phone.trim() || null,
        role_title: roleTitle.trim(),
        monthly_salary: salary !== '' ? Number(salary) : 0,
        joining_date: joiningDate,
        address: address.trim() || null,
      });

      setShowStaffModal(false);
      setName('');
      setPhone('');
      setSalary('');
      setAddress('');
      showSuccess(`Staff member "${name.trim()}" enrolled.`);
      await loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create staff');
    } finally {
      setSubmitting(false);
    }
  };

  const submitSalaryPayment = async (ownerPassword?: string) => {
    await api.payStaffSalary({
      staff_id: payStaffId,
      payment_type: payType,
      amount: Number(payAmount),
      payment_method: payMethod,
      notes: payNotes.trim() || null,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });

    setShowPayModal(false);
    setPayAmount('');
    setPayNotes('');
    setOverridePrompt(null);
    showSuccess(`${payType === 'ADVANCE' ? 'Advance' : 'Salary'} disbursement of ₹${Number(payAmount).toLocaleString('en-IN')} recorded.`);
    await loadData();
  };

  const handleRecordSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payStaffId || !payAmount || Number(payAmount) <= 0) {
      setFormError('Staff member and positive amount are required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      await submitSalaryPayment();
    } catch (err: any) {
      if (err?.requires_owner_password) {
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || 'Today is CLOSED. Verify Store Owner password to record this salary/advance payment.',
          confirmLabel: 'Verify & Record Payment',
          onConfirm: async (pwd) => {
            await submitSalaryPayment(pwd);
          },
        });
      } else {
        setFormError(err.message || 'Payment recording failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const submitReverseSalary = async (payment: any, reasonText: string, ownerPassword?: string) => {
    const res = await api.reverseSalaryPayment(payment.id, {
      reason: reasonText,
      ...(ownerPassword ? { owner_password: ownerPassword } : {}),
    });
    setReverseSalaryTarget(null);
    setReverseSalaryReason('');
    setOverridePrompt(null);
    const closedNote =
      res.modified_closed_dates && res.modified_closed_dates.length > 0
        ? ` Reconciled closed day (${res.modified_closed_dates.join(', ')}).`
        : '';
    showSuccess(`Reversed ${payment.payment_type} payment of ₹${Number(payment.amount || 0).toLocaleString('en-IN')}.${closedNote}`);
    await loadData();
  };

  const handleConfirmReverseSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseSalaryTarget) return;
    if (!reverseSalaryReason.trim()) {
      setReverseSalaryError('Mandatory reason is required to reverse a salary payment.');
      return;
    }

    setSubmitting(true);
    setReverseSalaryError(null);
    try {
      await submitReverseSalary(reverseSalaryTarget, reverseSalaryReason.trim());
    } catch (err: any) {
      if (err?.requires_owner_password) {
        const target = reverseSalaryTarget;
        const rsn = reverseSalaryReason.trim();
        setOverrideError(null);
        setOverridePrompt({
          title: 'Owner Authorization Required (Closed Day)',
          description: err.message || 'This salary payment belongs to a CLOSED business day. Verify Store Owner password to reverse it.',
          confirmLabel: 'Verify & Reverse Payment',
          onConfirm: async (pwd) => {
            await submitReverseSalary(target, rsn, pwd);
          },
        });
      } else {
        setReverseSalaryError(err.message || 'Failed to reverse salary payment');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOverrideConfirm = async (ownerPassword: string) => {
    if (!overridePrompt) return;
    setOverrideSubmitting(true);
    setOverrideError(null);
    try {
      await overridePrompt.onConfirm(ownerPassword);
    } catch (err: any) {
      setOverrideError(err.message || 'Authorization failed');
    } finally {
      setOverrideSubmitting(false);
    }
  };

  const handleSaveStoreProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingContacts(true);
    setContactsSuccess(null);
    setFormError(null);
    try {
      await api.updateStoreProfile({
        store_name: storeNameVal.trim(),
        store_location: storeLocVal.trim(),
        store_tagline: storeTagVal.trim(),
        contact_phone_1: contact1Val.trim(),
        contact_phone_2: contact2Val.trim(),
        contact_phone_3: contact3Val.trim(),
      });
      setContactsSuccess('Store Profile & 3 Contact Numbers saved successfully! Updated across POS receipts.');
      setTimeout(() => setContactsSuccess(null), 4000);
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save store profile');
    } finally {
      setSavingContacts(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim() || !newFullName.trim()) {
      setFormError('Username, password, and full name are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword.trim(),
        full_name: newFullName.trim(),
        role: newUserRole,
        phone: newUserPhone.trim() || null,
      });
      setShowUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewFullName('');
      setNewUserPhone('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user account');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await api.updateUser(editingUser.id, {
        full_name: editFullName.trim(),
        phone: editPhone.trim() || null,
        role: editRole,
        password: editPassword.trim() || undefined,
        is_active: editActive ? 1 : 0,
      });
      setEditingUser(null);
      setEditPassword('');
      loadData();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3DED5] pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[#1C1917]">Staff &amp; Attendance</h2>
          <p className="text-xs text-[#6F6962] mt-0.5">
            Track daily shop attendance, staff profiles, salaries &amp; advances for New Bhama Fashions
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-[#D4CDC2] p-1 rounded-xl text-xs mr-1 shadow-xs">
            <button
              onClick={() => setActiveTab('ATTENDANCE')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'ATTENDANCE' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Daily Attendance
            </button>
            <button
              onClick={() => setActiveTab('ROSTER')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activeTab === 'ROSTER' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
              }`}
            >
              Staff Roster
            </button>
            {isOwner && (
              <>
                <button
                  onClick={() => setActiveTab('PAYMENTS')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                    activeTab === 'PAYMENTS' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
                  }`}
                >
                  Salary &amp; Advances
                </button>
                <button
                  onClick={() => setActiveTab('OWNERS_CONTACTS')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
                    activeTab === 'OWNERS_CONTACTS' ? 'bg-[#171513] text-[#F5F2EC] shadow-sm' : 'text-[#6F6962] hover:text-[#1C1917]'
                  }`}
                >
                  <Store className="w-3.5 h-3.5 text-[#A67C52]" />
                  <span>Store Settings &amp; Logins</span>
                </button>
              </>
            )}
          </div>

          {isOwner && activeTab !== 'OWNERS_CONTACTS' && (
            <button
              onClick={() => setShowStaffModal(true)}
              className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-4 h-4 text-[#A67C52]" />
              <span>Add Staff</span>
            </button>
          )}

          {isOwner && activeTab === 'OWNERS_CONTACTS' && (
            <button
              onClick={() => {
                setNewUserRole('CASHIER');
                setNewUsername('');
                setNewPassword('');
                setNewFullName('');
                setNewUserPhone('');
                setFormError(null);
                setShowUserModal(true);
              }}
              className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
            >
              <UserPlus className="w-4 h-4 text-[#A67C52]" />
              <span>Add Staff / Cashier</span>
            </button>
          )}
        </div>
      </div>

      {pageBanner && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-3 ${
            pageBanner.type === 'success'
              ? 'bg-[#F4F9F5] border-[#CCE3D2] text-[#3F6B50]'
              : 'bg-[#FDF5F5] border-[#F0CCCC] text-[#A34F4F]'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {pageBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{pageBanner.text}</span>
          </div>
          <button onClick={() => setPageBanner(null)} className="opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Tab: ATTENDANCE */}
      {activeTab === 'ATTENDANCE' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-white border border-[#E3DED5] p-3.5 rounded-2xl shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
            <div className="flex items-center gap-2.5 text-xs">
              <Calendar className="w-4 h-4 text-[#A67C52]" />
              <span className="text-[#1C1917] font-semibold">Select Attendance Date:</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs font-medium focus:outline-none focus:border-[#A67C52]"
              />
            </div>

            <div className="text-xs text-[#6F6962] font-medium">
              Total <span className="text-[#1C1917] font-bold">{staffList.length}</span> Active Staff Members
            </div>
          </div>

          <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1C1917]">
                <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                  <tr>
                    <th className="px-4 py-3.5">Staff Member</th>
                    <th className="px-4 py-3.5">Designation / Role</th>
                    <th className="px-4 py-3.5 text-center">Status on {selectedDate}</th>
                    <th className="px-4 py-3.5 text-right">Quick Mark</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3DED5]">
                  {staffList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-14 text-center text-[#6F6962] space-y-2">
                        <UserCheck className="w-8 h-8 mx-auto text-[#9A938B] stroke-1" />
                        <p className="font-semibold text-sm text-[#1C1917]">No staff members enrolled yet.</p>
                        <p className="text-xs text-[#9A938B]">
                          Add sales assistants and store staff to start tracking attendance and salaries.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    staffList.map((s) => {
                      const record = attendance.find((a) => a.staff_id === s.id);
                      const status = record?.status;

                      return (
                        <tr key={s.id} className="hover:bg-[#FAF8F4] transition">
                          <td className="px-4 py-3.5 font-bold text-[#1C1917]">{s.name}</td>
                          <td className="px-4 py-3.5 text-[#6F6962]">{s.role_title}</td>
                          <td className="px-4 py-3.5 text-center">
                            {status ? (
                              <span
                                className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                                  status === 'PRESENT'
                                    ? 'bg-[#F4F9F5] text-[#3F6B50] border border-[#CCE3D2]'
                                    : status === 'ABSENT'
                                    ? 'bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC]'
                                    : status === 'HALF_DAY'
                                    ? 'bg-[#FAF8F4] text-[#A67C52] border border-[#D4CDC2]'
                                    : 'bg-[#FAF8F4] text-[#1C1917] border border-[#E3DED5]'
                                }`}
                              >
                                {status}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9A938B]">Not Marked</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                              <button
                                onClick={() => handleMarkAttendance(s, 'PRESENT', record)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${
                                  status === 'PRESENT'
                                    ? 'bg-[#3F6B50] text-white shadow-xs'
                                    : 'bg-white border border-[#D4CDC2] text-[#1C1917] hover:bg-[#FAF8F4]'
                                }`}
                              >
                                Present
                              </button>
                              <button
                                onClick={() => handleMarkAttendance(s, 'HALF_DAY', record)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${
                                  status === 'HALF_DAY'
                                    ? 'bg-[#A67C52] text-white shadow-xs'
                                    : 'bg-white border border-[#D4CDC2] text-[#1C1917] hover:bg-[#FAF8F4]'
                                }`}
                              >
                                Half-Day
                              </button>
                              <button
                                onClick={() => handleMarkAttendance(s, 'LEAVE', record)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${
                                  status === 'LEAVE'
                                    ? 'bg-[#171513] text-[#F5F2EC] shadow-xs'
                                    : 'bg-white border border-[#D4CDC2] text-[#1C1917] hover:bg-[#FAF8F4]'
                                }`}
                              >
                                Leave
                              </button>
                              <button
                                onClick={() => handleMarkAttendance(s, 'ABSENT', record)}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition ${
                                  status === 'ABSENT'
                                    ? 'bg-[#A34F4F] text-white shadow-xs'
                                    : 'bg-white border border-[#D4CDC2] text-[#1C1917] hover:bg-[#FAF8F4]'
                                }`}
                              >
                                Absent
                              </button>
                              {isOwner && record && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAttModal({
                                      mode: 'DELETE',
                                      staffId: s.id,
                                      staffName: s.name,
                                      attendanceId: record.id,
                                    });
                                    setAttReason('');
                                    setAttModalError(null);
                                  }}
                                  title="Clear / Remove Attendance Record"
                                  className="p-1.5 rounded-lg border border-[#F0CCCC] text-[#A34F4F] hover:bg-[#FDF5F5] transition ml-1"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: ROSTER */}
      {activeTab === 'ROSTER' && (
        <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1C1917]">
              <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                <tr>
                  <th className="px-4 py-3.5">Staff Name</th>
                  <th className="px-4 py-3.5">Role</th>
                  <th className="px-4 py-3.5">Phone</th>
                  <th className="px-4 py-3.5">Joining Date</th>
                  {isOwner && <th className="px-4 py-3.5 text-right">Monthly Salary</th>}
                  <th className="px-4 py-3.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3DED5]">
                {staffList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-[#9A938B]">
                      No staff records found.
                    </td>
                  </tr>
                ) : (
                  staffList.map((s) => (
                    <tr key={s.id} className="hover:bg-[#FAF8F4] transition">
                      <td className="px-4 py-3.5 font-bold text-[#1C1917]">{s.name}</td>
                      <td className="px-4 py-3.5 text-[#6F6962]">{s.role_title}</td>
                      <td className="px-4 py-3.5 text-[#6F6962] font-mono">{s.phone || '-'}</td>
                      <td className="px-4 py-3.5 text-[#6F6962] font-mono">{s.joining_date}</td>
                      {isOwner && (
                        <td className="px-4 py-3.5 text-right font-bold text-[#A67C52] text-sm">
                          {s.monthly_salary ? `₹${s.monthly_salary.toLocaleString('en-IN')}` : '-'}
                        </td>
                      )}
                      <td className="px-4 py-3.5 text-center">
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#F4F9F5] text-[#3F6B50] border border-[#CCE3D2]">
                          Active
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: PAYMENTS (Owner Only) */}
      {activeTab === 'PAYMENTS' && isOwner && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowPayModal(true)}
              className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shadow-sm"
            >
              <DollarSign className="w-4 h-4 text-[#A67C52]" />
              <span>Pay Salary / Advance</span>
            </button>
          </div>

          <div className="bg-white border border-[#E3DED5] rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-[#1C1917]">
                <thead className="bg-[#FAF8F4] text-[#6F6962] uppercase font-bold text-[10px] tracking-wider border-b border-[#E3DED5]">
                  <tr>
                    <th className="px-4 py-3.5">Date (IST)</th>
                    <th className="px-4 py-3.5">Staff Name</th>
                    <th className="px-4 py-3.5">Type</th>
                    <th className="px-4 py-3.5">Payment Mode</th>
                    <th className="px-4 py-3.5 text-right">Amount Paid</th>
                    <th className="px-4 py-3.5">Notes</th>
                    <th className="px-4 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E3DED5]">
                  {payments.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-[#9A938B]">
                        No salary or advance disbursements recorded yet.
                      </td>
                    </tr>
                  ) : (
                    payments.map((p) => {
                      const isReversed = Boolean(p.is_reversed);
                      return (
                      <tr key={p.id} className={`transition ${isReversed ? 'bg-[#FAF8F4]/70 opacity-70' : 'hover:bg-[#FAF8F4]'}`}>
                        <td className="px-4 py-3.5 text-[#6F6962] font-mono text-[11px] whitespace-nowrap">
                          {formatDateIST(p.created_at)}
                        </td>
                        <td className="px-4 py-3.5 font-bold text-[#1C1917]">{p.staff_name}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-[#FAF8F4] text-[#1C1917] border border-[#E3DED5]">
                              {p.payment_type}
                            </span>
                            {isReversed && (
                              <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC]">
                                Reversed
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-[#6F6962] font-medium">{p.payment_method}</td>
                        <td className={`px-4 py-3.5 text-right font-bold text-sm ${isReversed ? 'line-through text-[#9A938B]' : 'text-[#1C1917]'}`}>
                          ₹{p.amount.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3.5 text-[#6F6962]">{p.notes || '-'}</td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          {!isReversed && (
                            <button
                              type="button"
                              onClick={() => {
                                setReverseSalaryTarget(p);
                                setReverseSalaryReason('');
                                setReverseSalaryError(null);
                              }}
                              className="px-2.5 py-1 bg-white hover:bg-[#FDF5F5] text-[#A34F4F] border border-[#F0CCCC] rounded-lg text-[10px] font-semibold inline-flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>Reverse</span>
                            </button>
                          )}
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: OWNERS_CONTACTS */}
      {activeTab === 'OWNERS_CONTACTS' && isOwner && (
        <div className="space-y-6">
          {contactsSuccess && (
            <div className="p-3.5 bg-[#F4F9F5] border border-[#CCE3D2] rounded-xl text-xs text-[#3F6B50] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#3F6B50] shrink-0" />
              <span className="font-semibold">{contactsSuccess}</span>
            </div>
          )}

          {formError && (
            <div className="p-3 bg-[#FDF5F5] border border-[#F0CCCC] rounded-xl text-xs text-[#A34F4F] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#A34F4F] shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: 3 Contact Numbers & Store Profile (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-[#E3DED5] rounded-2xl p-6 space-y-5 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
              <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5]">
                    <PhoneCall className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[#1C1917]">3 Official Store Contact Numbers</h3>
                    <p className="text-[11px] text-[#6F6962]">Printed on 80mm/58mm thermal bills, receipts &amp; reports</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#FAF8F4] text-[#A67C52] border border-[#D4CDC2]">
                  Shop Identity
                </span>
              </div>

              <form onSubmit={handleSaveStoreProfile} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">Store Name</label>
                    <input
                      type="text"
                      required
                      value={storeNameVal}
                      onChange={(e) => setStoreNameVal(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#1C1917] mb-1">Location / City</label>
                    <input
                      type="text"
                      required
                      value={storeLocVal}
                      onChange={(e) => setStoreLocVal(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Store Tagline</label>
                  <input
                    type="text"
                    value={storeTagVal}
                    onChange={(e) => setStoreTagVal(e.target.value)}
                    placeholder="Store Tagline"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-medium focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div className="pt-2 border-t border-[#E3DED5] space-y-3">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#6F6962]">
                    Official Contact Numbers (3 Numbers)
                  </h4>

                  <div className="space-y-3">
                    <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                      <label className="block font-semibold text-[#1C1917] mb-1 flex items-center justify-between">
                        <span>Contact Number 1 (Counter / Billing Primary)</span>
                        <span className="text-[10px] text-[#A67C52] font-semibold">Primary Print</span>
                      </label>
                      <input
                        type="tel"
                        value={contact1Val}
                        onChange={(e) => setContact1Val(e.target.value)}
                        placeholder="Billing Counter Phone"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>

                    <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                      <label className="block font-semibold text-[#1C1917] mb-1 flex items-center justify-between">
                        <span>Contact Number 2 (Owner Mobile)</span>
                        <span className="text-[10px] text-[#A67C52] font-semibold">Store Owner</span>
                      </label>
                      <input
                        type="tel"
                        value={contact2Val}
                        onChange={(e) => setContact2Val(e.target.value)}
                        placeholder="Owner Personal Phone"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>

                    <div className="bg-[#FAF8F4] p-3.5 rounded-xl border border-[#E3DED5]">
                      <label className="block font-semibold text-[#1C1917] mb-1 flex items-center justify-between">
                        <span>Contact Number 3 (Shop WhatsApp / Alternate)</span>
                        <span className="text-[10px] text-[#3F6B50] font-semibold">Shop WhatsApp</span>
                      </label>
                      <input
                        type="tel"
                        value={contact3Val}
                        onChange={(e) => setContact3Val(e.target.value)}
                        placeholder="Shop WhatsApp Phone"
                        className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] text-xs focus:outline-none focus:border-[#A67C52]"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingContacts}
                    className="px-5 py-2.5 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold flex items-center gap-2 transition shadow-sm disabled:opacity-50"
                  >
                    <Check className="w-4 h-4 text-[#A67C52]" />
                    <span>{savingContacts ? 'Saving...' : 'Save 3 Contact Numbers & Profile'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Right: Store Administrator & Staff Logins (5 cols) */}
            <div className="lg:col-span-5 space-y-5">
              {/* Store Administrator Card */}
              <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
                <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-[#FAF8F4] text-[#A67C52] border border-[#E3DED5]">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#1C1917]">Store Administrator</h3>
                      <p className="text-[11px] text-[#6F6962]">Master Account with Full Control</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-[#EBF7EE] text-[#1E6B37] border border-[#BDE5C8]">
                    Master Owner
                  </span>
                </div>

                <div className="space-y-3">
                  {systemUsers.filter((u) => u.role === 'OWNER').map((owner) => (
                    <div
                      key={owner.id}
                      className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3.5 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-[#171513] text-[#F5F2EC] text-[10px] font-bold flex items-center justify-center">
                            1
                          </span>
                          <span className="font-bold text-[#1C1917] text-xs">{owner.full_name}</span>
                        </div>
                        <div className="text-[11px] text-[#6F6962] pl-7 space-y-0.5">
                          <p>
                            Username: <span className="text-[#1C1917] font-mono font-medium">{owner.username}</span>
                          </p>
                          <p>
                            Phone: <span className="text-[#1C1917]">{owner.phone || 'Not set'}</span>
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setEditingUser(owner);
                          setEditFullName(owner.full_name);
                          setEditPhone(owner.phone || '');
                          setEditRole(owner.role);
                          setEditActive(owner.is_active !== 0);
                          setEditPassword('');
                          setFormError(null);
                        }}
                        className="px-2.5 py-1.5 bg-white hover:bg-[#FAF8F4] text-[#1C1917] border border-[#D4CDC2] rounded-lg text-[11px] font-semibold flex items-center gap-1 transition shadow-xs"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#6F6962]" />
                        <span>Edit</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Billing Cashiers Card */}
              <div className="bg-white border border-[#E3DED5] rounded-2xl p-5 space-y-4 shadow-[0_2px_12px_rgba(23,21,19,0.03)]">
                <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-[#FAF8F4] text-[#1C1917] border border-[#E3DED5]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[#1C1917]">Billing Cashier Logins</h3>
                      <p className="text-[11px] text-[#6F6962]">POS Sales counter staff logins</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setNewUserRole('CASHIER');
                      setNewUsername('');
                      setNewPassword('');
                      setNewFullName('');
                      setNewUserPhone('');
                      setFormError(null);
                      setShowUserModal(true);
                    }}
                    className="text-[11px] font-bold text-[#A67C52] hover:text-[#8C633C]"
                  >
                    + Add Cashier
                  </button>
                </div>

                <div className="space-y-2">
                  {systemUsers.filter((u) => u.role === 'CASHIER').length === 0 ? (
                    <div className="py-4 text-center text-[#9A938B] text-xs">
                      No cashier staff logins created. Store Owner handles POS billing directly, or click '+ Add Cashier' to add counter logins.
                    </div>
                  ) : (
                    systemUsers.filter((u) => u.role === 'CASHIER').map((cashier) => (
                      <div
                        key={cashier.id}
                        className="bg-[#FAF8F4] border border-[#E3DED5] rounded-xl p-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-bold text-[#1C1917] text-xs">{cashier.full_name}</div>
                          <div className="text-[11px] text-[#6F6962] font-mono">
                            @{cashier.username} {cashier.phone ? `&bull; ${cashier.phone}` : ''}
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setEditingUser(cashier);
                            setEditFullName(cashier.full_name);
                            setEditPhone(cashier.phone || '');
                            setEditRole(cashier.role);
                            setEditActive(cashier.is_active !== 0);
                            setEditPassword('');
                            setFormError(null);
                          }}
                          className="p-1.5 text-[#6F6962] hover:text-[#1C1917]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showStaffModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Add Staff Member</h3>
              <button onClick={() => setShowStaffModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateStaff} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone Number"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Role / Title *</label>
                  <input
                    type="text"
                    required
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                    placeholder="Role / Title"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Monthly Salary (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={salary}
                    onChange={(e) => setSalary(Number(e.target.value))}
                    placeholder="Monthly Salary"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Joining Date</label>
                  <input
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Address / Village</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Address"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Saving...' : 'Save Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Salary / Advance Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Record Salary / Advance Payment</h3>
              <button onClick={() => setShowPayModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleRecordSalary} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Staff Member *</label>
                <select
                  required
                  value={payStaffId}
                  onChange={(e) => setPayStaffId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="">Select Staff...</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role_title})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Disbursement Type</label>
                  <select
                    value={payType}
                    onChange={(e: any) => setPayType(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  >
                    <option value="SALARY">Monthly Salary</option>
                    <option value="ADVANCE">Advance Against Salary</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={payAmount}
                    onChange={(e) => setPayAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-bold focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e: any) => setPayMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="CASH">Cash Drawer</option>
                  <option value="UPI">UPI Transfer</option>
                  <option value="BANK">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Notes / Month Reference</label>
                <input
                  type="text"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Notes / Month Reference"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowPayModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Recording...' : 'Disburse Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal (Add Owner or Cashier) */}
      {showUserModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Add System User / Store Account</h3>
              <button onClick={() => setShowUserModal(false)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Account Role *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewUserRole('OWNER')}
                    className={`py-2 px-3 rounded-xl text-center border font-semibold transition ${
                      newUserRole === 'OWNER'
                        ? 'bg-[#171513] text-[#F5F2EC] border-[#171513] shadow-xs'
                        : 'bg-white text-[#6F6962] border-[#D4CDC2] hover:text-[#1C1917]'
                    }`}
                  >
                    Store Owner (Master)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewUserRole('CASHIER')}
                    className={`py-2 px-3 rounded-xl text-center border font-semibold transition ${
                      newUserRole === 'CASHIER'
                        ? 'bg-[#171513] text-[#F5F2EC] border-[#171513] shadow-xs'
                        : 'bg-white text-[#6F6962] border-[#D4CDC2] hover:text-[#1C1917]'
                    }`}
                  >
                    Billing Cashier
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mobile Phone</label>
                <input
                  type="tel"
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  placeholder="Mobile Phone"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Login Username *</label>
                  <input
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                    placeholder="Username"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] font-mono focus:outline-none focus:border-[#A67C52]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-[#1C1917] mb-1">Password *</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Password"
                    className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setShowUserModal(false)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <h3 className="font-bold text-base text-[#1C1917]">Edit User: {editingUser.username}</h3>
              <button onClick={() => setEditingUser(null)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {formError}
              </div>
            )}

            <form onSubmit={handleUpdateUser} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mobile Phone</label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Mobile Phone"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as 'OWNER' | 'CASHIER')}
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                >
                  <option value="OWNER">Store Owner</option>
                  <option value="CASHIER">Billing Cashier</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">
                  Change Password (leave blank to keep current)
                </label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="New password (optional)"
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-[#1C1917]">
                  <input
                    type="checkbox"
                    checked={editActive}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="w-4 h-4 rounded border-[#D4CDC2] text-[#A67C52] focus:ring-0"
                  />
                  <span className="font-medium">Account Active (can log in)</span>
                </label>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Saving...' : 'Update Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attendance Edit/Delete Reason Modal */}
      {attModal && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className={`font-bold text-sm ${attModal.mode === 'DELETE' ? 'text-[#A34F4F]' : 'text-[#1C1917]'}`}>
                  {attModal.mode === 'DELETE' ? 'Remove Attendance Record' : 'Update Past Attendance'}
                </h3>
                <p className="text-[11px] text-[#6F6962]">
                  {attModal.staffName} &bull; {selectedDate}
                  {attModal.status ? ` → ${attModal.status}` : ''}
                </p>
              </div>
              <button onClick={() => setAttModal(null)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {attModalError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {attModalError}
              </div>
            )}

            <form onSubmit={handleConfirmAttModal} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mandatory Audit Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={attReason}
                  onChange={(e) => setAttReason(e.target.value)}
                  placeholder="Enter reason for modifying or removing attendance..."
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setAttModal(null)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-4 py-2 text-white rounded-xl font-semibold shadow-sm disabled:opacity-50 transition ${
                    attModal.mode === 'DELETE' ? 'bg-[#A34F4F] hover:bg-[#8E4141]' : 'bg-[#171513] hover:bg-[#25211D]'
                  }`}
                >
                  {submitting ? 'Saving...' : attModal.mode === 'DELETE' ? 'Confirm Removal' : 'Save Attendance Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reverse Salary Payment Modal */}
      {reverseSalaryTarget && (
        <div className="fixed inset-0 z-50 bg-[#171513]/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-[#E3DED5] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-[0_8px_30px_rgba(23,21,19,0.12)]">
            <div className="flex items-center justify-between border-b border-[#E3DED5] pb-3">
              <div>
                <h3 className="font-bold text-sm text-[#A34F4F]">Reverse Salary / Advance Payment</h3>
                <p className="text-[11px] text-[#6F6962]">
                  {reverseSalaryTarget.staff_name} &bull; ₹{Number(reverseSalaryTarget.amount || 0).toLocaleString('en-IN')} ({reverseSalaryTarget.payment_method})
                </p>
              </div>
              <button onClick={() => setReverseSalaryTarget(null)} className="text-[#9A938B] hover:text-[#1C1917]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {reverseSalaryError && (
              <div className="p-2.5 bg-[#FDF5F5] border border-[#F0CCCC] rounded-lg text-xs text-[#A34F4F]">
                {reverseSalaryError}
              </div>
            )}

            <form onSubmit={handleConfirmReverseSalary} className="space-y-3 text-xs">
              <p className="text-[#6F6962]">
                Safely marks this payment as Reversed, restores account balances, and reconciles closed-day snapshots if needed.
              </p>

              <div>
                <label className="block font-semibold text-[#1C1917] mb-1">Mandatory Reversal Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={reverseSalaryReason}
                  onChange={(e) => setReverseSalaryReason(e.target.value)}
                  placeholder="Enter reason for reversing this salary payment..."
                  className="w-full px-3 py-2 bg-white border border-[#D4CDC2] rounded-xl text-[#1C1917] focus:outline-none focus:border-[#A67C52]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2 border-t border-[#E3DED5]">
                <button
                  type="button"
                  onClick={() => setReverseSalaryTarget(null)}
                  className="px-4 py-2 border border-[#D4CDC2] text-[#6F6962] hover:text-[#1C1917] rounded-xl font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#A34F4F] hover:bg-[#8E4141] text-white rounded-xl font-semibold shadow-sm disabled:opacity-50 transition"
                >
                  {submitting ? 'Reversing...' : 'Confirm Reversal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Owner Override Verification Prompt */}
      <OwnerOverridePrompt
        isOpen={Boolean(overridePrompt)}
        title={overridePrompt?.title}
        description={overridePrompt?.description || ''}
        requireReason={false}
        confirmLabel={overridePrompt?.confirmLabel}
        errorMessage={overrideError}
        submitting={overrideSubmitting}
        onCancel={() => {
          setOverridePrompt(null);
          setOverrideError(null);
        }}
        onConfirm={handleOverrideConfirm}
      />
    </div>
  );
};
