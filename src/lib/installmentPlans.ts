export type InstallmentInvoiceBalance = {
  id: string;
  dueDate: string;
  balanceRemaining: number;
};

export type InstallmentScheduleInput = {
  totalAmount: number;
  installmentCount: number;
  firstDueDate: string;
  intervalMonths: number;
  dayOfMonth: number;
};

export type InstallmentScheduleResult = {
  installmentNo: number;
  dueDate: string;
  amount: number;
};

const cents = (value: number) => Math.round(value * 100);

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addMonthsWithDay(date: Date, months: number, dayOfMonth: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(Math.max(dayOfMonth, 1), lastDay));
  return result;
}

export function calculateInstallmentSchedule(input: InstallmentScheduleInput): InstallmentScheduleResult[] {
  const totalCents = cents(input.totalAmount);
  const count = Math.max(1, Math.floor(input.installmentCount));
  const interval = Math.max(1, Math.floor(input.intervalMonths));
  const regularCents = Math.floor(totalCents / count);
  const remainder = totalCents - regularCents * count;
  const first = new Date(`${input.firstDueDate}T00:00:00.000Z`);

  return Array.from({ length: count }, (_, index) => ({
    installmentNo: index + 1,
    dueDate: isoDate(addMonthsWithDay(first, index * interval, input.dayOfMonth)),
    amount: (regularCents + (index === count - 1 ? remainder : 0)) / 100,
  }));
}

export function subtractCalendarDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - Math.max(0, Math.floor(days)));
  return isoDate(date);
}

export function allocatePaymentOldestFirst(
  invoices: InstallmentInvoiceBalance[],
  paymentAmount: number,
) {
  let remainingCents = cents(paymentAmount);
  return [...invoices]
    .filter(invoice => cents(invoice.balanceRemaining) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    .map(invoice => {
      const allocationCents = Math.min(remainingCents, cents(invoice.balanceRemaining));
      remainingCents -= allocationCents;
      return { invoiceId: invoice.id, amount: allocationCents / 100 };
    })
    .filter(allocation => allocation.amount > 0);
}

export function deriveInstallmentPlanStatus(totalAmount: number, paidAmount: number, hasOverdue: boolean, currentStatus: string) {
  if (currentStatus === 'cancelled' || currentStatus === 'paused' || currentStatus === 'draft' || currentStatus === 'pending_approval') return currentStatus;
  if (paidAmount >= totalAmount) return 'completed';
  return hasOverdue ? 'overdue' : 'active';
}
