import type { ProfileDto } from '@/lib/api/types';

export type ProfileSection = 'profile' | 'orders';

export interface EditableProfile {
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  address: string;
  zip: string;
  city: string;
}

export interface ProfileRecord extends ProfileDto {
  emailVerified: boolean | number;
}

export interface OrderFilters {
  year: string;
  month: string;
  status: string;
  returnStatus: string;
  paymentStatus: string;
}

export interface OrderFilterOptions {
  years: Array<string | number>;
  months: Array<string | number>;
  statuses: string[];
  returnStatuses: string[];
  paymentStatuses: string[];
}

export interface OrderPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ReturnImageRecord {
  id: number;
  orderItemId?: number;
  imagePath: string;
  created_at?: string;
}

export interface ReviewRecord {
  id?: number;
  productId?: number;
  orderId?: number;
  rating: number;
  reviewText?: string | null;
  createdAt?: string;
}

export interface PaymentRecord {
  id: number;
  orderItemId?: number | null;
  paymentType?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  amount?: number | string;
  checkoutUrl?: string | null;
  note?: string | null;
  refundGroupKey?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
}

export interface CustomerOrderItem {
  id: number;
  orderId?: number;
  productId?: number;
  title?: string;
  rentalStart?: string;
  rentalEnd?: string;
  pricePerDay?: number | string;
  deposit?: number | string;
  itemStatus?: string;
  pickedUpAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  cancelledByName?: string | null;
  actualReturnDate?: string | null;
  returnStatus?: string | null;
  isDamaged?: boolean | number;
  damageDescription?: string | null;
  isLate?: boolean | number;
  lateDescription?: string | null;
  adjustedRentalStart?: string | null;
  adjustedRentalEnd?: string | null;
  adjustedPricePerDay?: number | string | null;
  adjustedRentalTotal?: number | string | null;
  depositDecision?: string | null;
  depositRefundAmount?: number | string | null;
  depositDeductionAmount?: number | string | null;
  depositDeductionReason?: string | null;
  additionalChargeReason?: string | null;
  additionalChargeAmount?: number | string | null;
  returnNotes?: string | null;
  returnedAt?: string | null;
  returnCaseProcessedAt?: string | null;
  returnImages?: ReturnImageRecord[];
  review?: ReviewRecord | null;
}

export interface CustomerOrderSummary {
  id: number;
  order_no?: string;
  customer_email?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  status?: string;
  payment_method?: string;
  payment_status?: string;
  return_status?: string;
  return_case_status?: string;
  created_at?: string;
  reserved_until?: string | null;
  returned_at?: string | null;
  cancelReason?: string | null;
  cancelledByName?: string | null;
  cancelledAt?: string | null;
  items?: CustomerOrderItem[];
}

export interface CustomerOrderDetails extends CustomerOrderSummary {
  customer_company?: string | null;
  customer_phone?: string;
  customer_address?: string;
  customer_zip?: string;
  customer_city?: string;
  cancel_reason?: string | null;
  cancelled_at?: string | null;
  payments?: PaymentRecord[];
  returnImages?: ReturnImageRecord[];
}

export interface CustomerOrderListResponse {
  items: CustomerOrderSummary[];
  pagination: OrderPagination;
  filterOptions: OrderFilterOptions;
}

export interface ItemFinancials {
  originalDays: number;
  effectiveDays: number;
  extendedDays: number;
  pricePerDay: number;
  rentalTotal: number;
  deposit: number;
  depositRefund: number;
  depositRetained: number;
  additionalCharge: number;
  grossTotalWithDeposit: number;
  customerAdditionalDue: number;
  customerCredit: number;
  originalRentalTotal: number;
  rentalAdjustment: number;
  lateDays: number;
  lateFee: number;
  repairCharge: number;
  additionalChargeReason: string;
}

export interface ReviewDraft {
  rating: string;
  reviewText: string;
}
