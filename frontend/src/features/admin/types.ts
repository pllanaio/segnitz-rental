import type { AuthStatus, Category, ProductDto } from '@/lib/api/types';

export type { AuthStatus, Category, ProductDto };

export type AdminView = 'products' | 'orders' | 'opening-hours';

export interface AdminProductImage {
  id: number;
  path: string;
}

export interface AdminProduct extends ProductDto {
  id: number;
  product_key: string;
  title: string;
  description: string | null;
  price_per_day: number | string;
  deposit: number | string;
  image_path: string | null;
  is_active: number | boolean;
  images: AdminProductImage[];
  categories: Category[];
}

export interface AdminOrderItem {
  id: number;
  productId?: number;
  title?: string;
  itemStatus?: string;
  item_status?: string;
  pickedUpAt?: string | null;
  picked_up_at?: string | null;
  cancelledAt?: string | null;
  cancelReason?: unknown;
  cancelledByName?: string | null;
  rentalStart?: string;
  rentalEnd?: string;
  pricePerDay?: number | string;
  deposit?: number | string;
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
  depositDeductionPercent?: number | string | null;
  depositDeductionReason?: string | null;
  additionalChargeReason?: string | null;
  additionalChargeAmount?: number | string | null;
  returnNotes?: string | null;
  returnedAt?: string | null;
  returnCaseProcessedAt?: string | null;
  returnImages?: AdminReturnImage[];
}

export interface AdminReturnImage {
  id: number;
  orderItemId?: number;
  imagePath: string;
  created_at?: string;
}

export interface AdminPayment {
  id: number;
  orderId?: number;
  orderItemId?: number | null;
  paymentType?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  amount?: number | string;
  molliePaymentId?: string | null;
  checkoutUrl?: string | null;
  paidAt?: string | null;
  note?: string | null;
  createdAt?: string | null;
  mollieCustomerId?: string | null;
  mollieMandateId?: string | null;
  sequenceType?: string | null;
}

export interface AdminOrder {
  id: number;
  order_no?: string;
  status?: string;
  payment_method?: string;
  payment_status?: string;
  return_status?: string;
  return_case_status?: string;
  created_at?: string;
  reserved_until?: string;
  returned_at?: string;
  cancelled_at?: string;
  cancelledAt?: string;
  cancelled_by_username?: string;
  cancel_reason?: unknown;
  cancelReason?: unknown;
  customer_email?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  customer_company?: string | null;
  customer_phone?: string;
  customer_address?: string;
  customer_zip?: string;
  customer_city?: string;
  items?: AdminOrderItem[];
  payments?: AdminPayment[];
  returnImages?: AdminReturnImage[];
  [key: string]: unknown;
}

export interface AdminOrderPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AdminOrderFilterOptions {
  years: string[];
  months: string[];
  statuses: string[];
  returnStatuses: string[];
  paymentStatuses: string[];
}

export interface AdminOrderListResponse {
  items: AdminOrder[];
  pagination: AdminOrderPagination;
  filterOptions: AdminOrderFilterOptions;
}

export interface AdminOpeningHour {
  weekday: number;
  is_open: boolean | number;
  open_time: string | null;
  close_time: string | null;
}

export interface AdminMessageResponse {
  message?: string;
  productId?: number;
  paymentStatus?: string;
  adjustedRentalTotal?: number | string;
}

export interface PaymentAction {
  mode: 'payment' | 'refund';
  orderId: number;
  orderItemId: number | null;
  paymentType: string;
  amount: number;
}

export type Notify = (
  message: string,
  tone?: 'success' | 'danger' | 'info' | 'warning',
  duration?: number,
) => number;
