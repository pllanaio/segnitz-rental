export type UserRole = 'global_admin' | 'user' | 'customer' | 'bearbeiter' | string;

export interface AuthStatus {
  loggedIn: boolean;
  user: string | null;
  role: UserRole | null;
  csrfToken?: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface ProductImage {
  id: number;
  path: string;
}

export interface ProductDto {
  id: number | string;
  product_key?: string;
  title?: string;
  description?: string | null;
  price_per_day?: number | string;
  deposit?: number | string;
  image_path?: string | null;
  is_active?: number | boolean;
  category?: string | null;
  average_rating?: number | string | null;
  review_count?: number | string | null;
  images?: ProductImage[];
  categories?: Category[];
}

export interface Product {
  id: number;
  key: string;
  title: string;
  description: string;
  pricePerDay: number;
  deposit: number;
  imagePath: string | null;
  isActive: boolean;
  rating: number;
  reviewCount: number;
  images: ProductImage[];
  categories: Category[];
}

export interface CartItem {
  id: number;
  productId: number;
  rentalStart: string;
  rentalEnd: string;
  quantity: number;
  productKey: string;
  title: string;
  description: string;
  pricePerDay: number | string;
  deposit: number | string;
  imagePath: string | null;
}

export interface CartResponse {
  cartId: number | null;
  items: CartItem[];
}

export interface OpeningStatus {
  isOpen: boolean;
  label: string;
  openTime?: string;
  closeTime?: string;
}

export interface ProfileDto {
  email: string;
  firstName: string;
  lastName: string;
  company?: string | null;
  phone: string;
  address: string;
  zip: string;
  city: string;
  customerNo: string;
  emailVerified: boolean | number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface FilterOptions {
  years: Array<string | number>;
  months: Array<string | number>;
  statuses: string[];
  returnStatuses: string[];
  paymentStatuses: string[];
}

export interface OrderSummary {
  id: number;
  order_no?: string;
  status?: string;
  payment_status?: string;
  payment_method?: string;
  return_status?: string;
  return_case_status?: string;
  created_at?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: number;
  productId?: number;
  title?: string;
  rentalStart?: string;
  rentalEnd?: string;
  pricePerDay?: number | string;
  deposit?: number | string;
  itemStatus?: string;
  returnStatus?: string;
  actualReturnDate?: string | null;
  returnImages?: ReturnImage[];
  review?: Review | null;
  [key: string]: unknown;
}

export interface ReturnImage {
  id: number;
  path: string;
}

export interface Review {
  rating: number;
  reviewText?: string | null;
  createdAt?: string;
}

export interface Payment {
  id: number;
  orderItemId?: number | null;
  paymentType?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  amount?: number | string;
  checkoutUrl?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface OrderDetails extends OrderSummary {
  customer_email?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_zip?: string;
  customer_city?: string;
  payments?: Payment[];
  [key: string]: unknown;
}

export interface OrderListResponse {
  items: OrderSummary[];
  pagination: Pagination;
  filterOptions: FilterOptions;
}

export interface OpeningHour {
  weekday: number;
  is_open: boolean | number;
  open_time: string | null;
  close_time: string | null;
}
