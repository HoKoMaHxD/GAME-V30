export const PROTECTION_PRICE = 10000;
export const PROTECTION_DURATION_MS = 3 * 3600000;

// The journal commits the purchase before this idempotent wallet debit. The
// separate purchase receipt keeps the shield alive across wallet resets.
export function applyProtectionPurchase(state, purchase) {
  if (state._id !== purchase.dayId || state.userId !== purchase.userId) throw new Error('سجل العضو لا يطابق طلب الحماية.');
  if (state.protectionReceipts?.includes(purchase.id)) return false;
  if (!Number.isSafeInteger(purchase.price) || purchase.price <= 0
    || !['tasks', 'attendance'].every(key => Number.isSafeInteger(purchase.debit?.[key]) && purchase.debit[key] >= 0)
    || purchase.debit.tasks + purchase.debit.attendance !== purchase.price) throw new Error('خصم الحماية غير صالح.');
  const amounts = Object.fromEntries(['tasks', 'attendance'].map(key => [key,
    (state.protectionAdjustments?.[key] || 0) - purchase.debit[key]]));
  if (!Object.values(amounts).every(Number.isSafeInteger)) throw new Error('خصم الحماية يتجاوز الحد الرقمي المسموح.');
  state.protectionAdjustments = amounts;
  (state.protectionReceipts ||= []).push(purchase.id);
  state.financialContext ||= structuredClone(purchase);
  return true;
}
