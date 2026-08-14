export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
export const HEX_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).byteLength;
}

export function isCustomerPasswordValid(password: string): boolean {
  return password.length >= 8 &&
    passwordByteLength(password) <= 72 &&
    /[0-9]/u.test(password) &&
    /[^A-Za-z0-9]/u.test(password);
}

export function isAdminPasswordValid(password: string): boolean {
  return password.length >= 12 &&
    passwordByteLength(password) <= 72 &&
    /[a-z]/u.test(password) &&
    /[A-Z]/u.test(password) &&
    /[0-9]/u.test(password) &&
    /[^A-Za-z0-9]/u.test(password);
}

export function safeLocalRedirect(value: unknown, fallback: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\r\n]/u.test(value)
  ) {
    return fallback;
  }

  return value;
}
