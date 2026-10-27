import React from 'react';
import { Printer, X, CheckCircle2 } from 'lucide-react';

interface ReceiptModalProps {
  sale: any;
  onClose: () => void;
  storeName?: string;
  storeLocation?: string;
  contacts?: string[];
  returnRecord?: any;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  sale,
  onClose,
  storeName = 'New Bhama Fashions',
  storeLocation = 'Chilakaluripet, Andhra Pradesh',
  contacts = [],
  returnRecord,
}) => {
  if (!sale && !returnRecord) return null;

  const isCancelled = sale?.status === 'CANCELLED';
  const validContacts = contacts.filter((c) => c && c.trim().length > 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#171513]/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white text-[#1C1917] rounded-2xl shadow-[0_12px_40px_rgba(23,21,19,0.2)] max-w-sm w-full overflow-hidden flex flex-col my-8 border border-[#E3DED5]">
        {/* Modal Header */}
        <div className={`px-4 py-3.5 border-b flex items-center justify-between no-print ${
          isCancelled ? 'bg-[#3A1414] border-[#5A2020]' : returnRecord ? 'bg-[#1D2B22] border-[#2E4737]' : 'bg-[#171513] border-[#2A2521]'
        }`}>
          <div className="flex items-center gap-2 font-semibold text-sm">
            {isCancelled ? (
              <span className="text-[#FFA3A3] font-bold">CANCELLED / VOID BILL</span>
            ) : returnRecord ? (
              <span className="text-[#A2E3B8] font-bold">Return Slip / Credit Note</span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 text-[#A67C52]" />
                <span className="text-[#F5F2EC]">Bill Receipt</span>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#9A938B] hover:text-[#F5F2EC] p-1 rounded-md transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cancellation Warning Banner (Screen View) */}
        {isCancelled && (
          <div className="p-3 bg-[#FDF5F5] border-b border-[#F0CCCC] text-xs text-[#A34F4F] space-y-1 no-print">
            <div className="font-bold flex items-center gap-1.5">
              <span>⚠️ THIS BILL HAS BEEN CANCELLED &amp; VOIDED</span>
            </div>
            <p className="text-[11px] text-[#6F6962]">
              Cancelled by: <strong className="text-[#1C1917]">{sale.cancelled_by_name || 'Owner'}</strong> on{' '}
              {new Date(sale.cancelled_at || sale.updated_at || Date.now()).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
            {sale.cancelled_reason && (
              <p className="text-[11px] text-[#6F6962]">
                Reason: <span className="text-[#A34F4F] font-medium">{sale.cancelled_reason}</span>
              </p>
            )}
          </div>
        )}

        {/* Receipt Content (Formatted for standard 80mm Thermal Printer) */}
        <div id="thermal-receipt" className="p-5 font-mono text-xs space-y-3 bg-white text-black">
          <div className="text-center space-y-0.5 border-b border-dashed border-slate-300 pb-3">
            <h2 className="text-base font-bold tracking-tight uppercase">{storeName}</h2>
            <p className="text-[11px] text-slate-600">Ladies Fashion Retail</p>
            <p className="text-[10px] text-slate-500">{storeLocation}</p>
            {validContacts.length > 0 ? (
              <p className="text-[10px] text-slate-700 font-sans font-medium mt-1">
                Ph: {validContacts.join(' • ')}
              </p>
            ) : (
              <p className="text-[10px] text-slate-500 font-sans mt-1">Ph: 98480xxxxx</p>
            )}
          </div>

          {/* Prominent Thermal Void Watermark if cancelled */}
          {isCancelled && (
            <div className="p-2 border-2 border-dashed border-red-600 text-center text-red-600 font-bold space-y-0.5 my-2">
              <p className="text-sm tracking-wider">*** CANCELLED / VOID ***</p>
              <p className="text-[10px]">TRANSACTION REVERSED</p>
              <p className="text-[9px] font-normal text-slate-700">By: {sale.cancelled_by_name || 'Owner'}</p>
              <p className="text-[9px] font-normal text-slate-700">Reason: {sale.cancelled_reason || 'Void'}</p>
            </div>
          )}

          {/* Return Record Thermal View */}
          {returnRecord ? (
            <div className="space-y-3">
              <div className="p-1.5 border border-dashed border-slate-400 text-center font-bold text-xs uppercase">
                Customer Return Slip
              </div>
              <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span className="font-semibold">Return No:</span>
                  <span className="font-bold">{returnRecord.return_number}</span>
                </div>
                <div className="flex justify-between">
                  <span>Orig Bill No:</span>
                  <span className="font-bold">{returnRecord.bill_number}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Date:</span>
                  <span>{new Date(returnRecord.created_at || Date.now()).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Processed By:</span>
                  <span>{returnRecord.returned_by_name || 'Staff'}</span>
                </div>
              </div>

              {/* Returned Items */}
              <div className="border-b border-dashed border-slate-300 pb-2">
                <div className="grid grid-cols-12 font-bold text-[10px] border-b border-slate-200 pb-1 mb-1">
                  <div className="col-span-6">Returned Item</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-4 text-right">Refund (₹)</div>
                </div>
                <div className="space-y-1">
                  {returnRecord.items?.map((it: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-12 text-[11px] leading-tight">
                      <div className="col-span-6 font-medium truncate">{it.product_name}</div>
                      <div className="col-span-2 text-center">{it.quantity}</div>
                      <div className="col-span-4 text-right font-semibold">₹{it.refund_amount}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1 text-[11px] border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between text-sm font-bold">
                  <span>Total Refund:</span>
                  <span>₹{returnRecord.refund_amount}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Refund Method:</span>
                  <span className="font-semibold">{returnRecord.refund_method}</span>
                </div>
                {returnRecord.reason && (
                  <div className="flex justify-between text-slate-600 text-[10px]">
                    <span>Reason:</span>
                    <span>{returnRecord.reason}</span>
                  </div>
                )}
                {returnRecord.remaining_sale_value !== undefined && (
                  <div className="flex justify-between text-[10px] text-slate-700 pt-1 border-t border-slate-200 font-semibold">
                    <span>Remaining Sale Value:</span>
                    <span>₹{returnRecord.remaining_sale_value}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span className="font-semibold">Bill No:</span>
                  <span className="font-bold">{sale.bill_number}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Date:</span>
                  <span>{new Date(sale.created_at || Date.now()).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                {sale.customer_name && (
                  <div className="flex justify-between text-slate-700">
                    <span>Customer:</span>
                    <span>{sale.customer_name} {sale.customer_phone ? `(${sale.customer_phone})` : ''}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Cashier:</span>
                  <span>{sale.cashier_name || 'Staff'}</span>
                </div>
              </div>

              {/* Items Table */}
              <div className="border-b border-dashed border-slate-300 pb-2">
                <div className="grid grid-cols-12 font-bold text-[10px] border-b border-slate-200 pb-1 mb-1">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-2 text-right">Rate</div>
                  <div className="col-span-2 text-right">Total</div>
                </div>

                <div className="space-y-1">
                  {sale.items?.map((it: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-12 text-[11px] leading-tight">
                      <div className="col-span-6">
                        <div className="font-medium truncate">{it.product_name || it.name}</div>
                        {it.variant_desc && (
                          <div className="text-[9px] text-slate-500">{it.variant_desc}</div>
                        )}
                      </div>
                      <div className="col-span-2 text-center">{it.quantity}</div>
                      <div className="col-span-2 text-right">₹{it.unit_price}</div>
                      <div className="col-span-2 text-right font-semibold">₹{it.total_price}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-1 text-[11px] border-b border-dashed border-slate-300 pb-2">
                {sale.total_mrp && sale.total_mrp > (sale.subtotal || sale.total_amount) && (
                  <div className="flex justify-between text-slate-500">
                    <span>Total MRP:</span>
                    <span className="line-through">₹{sale.total_mrp}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Selling Price:</span>
                  <span>₹{sale.subtotal}</span>
                </div>
                {sale.festival_discount > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>Festival Offer:</span>
                    <span>-₹{sale.festival_discount}</span>
                  </div>
                )}
                {sale.special_discount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>Special Discount:</span>
                    <span>-₹{sale.special_discount}</span>
                  </div>
                )}
                {!sale.festival_discount && !sale.special_discount && sale.discount_amount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount:</span>
                    <span>-₹{sale.discount_amount}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-slate-200">
                  <span>Grand Total:</span>
                  <span>₹{sale.total_amount}</span>
                </div>

                {sale.total_refunded_amount > 0 && (
                  <div className="flex justify-between text-xs font-semibold text-rose-700 pt-1">
                    <span>Returned Items Refund:</span>
                    <span>-₹{sale.total_refunded_amount}</span>
                  </div>
                )}

                {sale.total_refunded_amount > 0 && (
                  <div className="flex justify-between text-xs font-bold text-slate-900 pt-0.5">
                    <span>Net Active Sale Value:</span>
                    <span>₹{Math.max(0, sale.total_amount - sale.total_refunded_amount)}</span>
                  </div>
                )}

                {((sale.total_savings && sale.total_savings > 0) || (sale.total_mrp && sale.total_mrp > sale.total_amount)) && (
                  <div className="flex justify-between text-[10px] text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded font-semibold mt-1">
                    <span>Total Customer Savings:</span>
                    <span>₹{sale.total_savings || (sale.total_mrp - sale.total_amount)}</span>
                  </div>
                )}
              </div>

              {/* Payment Details */}
              <div className="text-[11px] space-y-0.5 border-b border-dashed border-slate-300 pb-2">
                <div className="flex justify-between">
                  <span>Payment Mode:</span>
                  <span className="font-semibold">{sale.payment_method}</span>
                </div>
                <div className="flex justify-between">
                  <span>Paid:</span>
                  <span>₹{sale.amount_paid}</span>
                </div>
                {sale.cash_paid > 0 && sale.payment_method === 'SPLIT' && (
                  <div className="flex justify-between text-slate-600 text-[10px] pl-2">
                    <span>• Cash Paid:</span>
                    <span>₹{sale.cash_paid}</span>
                  </div>
                )}
                {sale.upi_paid > 0 && sale.payment_method === 'SPLIT' && (
                  <div className="flex justify-between text-slate-600 text-[10px] pl-2">
                    <span>• UPI Paid:</span>
                    <span>₹{sale.upi_paid}</span>
                  </div>
                )}
                {sale.card_paid > 0 && (
                  <div className="flex justify-between text-slate-600 text-[10px] pl-2">
                    <span>• Card Paid:</span>
                    <span>₹{sale.card_paid}</span>
                  </div>
                )}
                {sale.balance_due > 0 && (
                  <div className="flex justify-between text-red-600 font-bold">
                    <span>Balance Due (Credit):</span>
                    <span>₹{sale.balance_due}</span>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="text-center text-[10px] text-slate-500 pt-1 space-y-0.5">
            <p>Thank You! Visit Again.</p>
            <p className="text-[9px]">Exchange valid within 7 days with original bill.</p>
            <p className="font-mono text-[9px] tracking-widest mt-1">*{sale?.bill_number || returnRecord?.return_number}*</p>
          </div>
        </div>

        {/* Print / Actions Bar */}
        <div className="p-3.5 bg-[#FAF8F4] border-t border-[#E3DED5] flex gap-2 no-print">
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 px-3 bg-[#171513] hover:bg-[#25211D] text-[#F5F2EC] rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition"
          >
            <Printer className="w-4 h-4 text-[#A67C52]" />
            Print Receipt
          </button>
          <button
            onClick={onClose}
            className="py-2.5 px-4 border border-[#D4CDC2] hover:bg-white text-[#1C1917] rounded-xl text-xs font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
