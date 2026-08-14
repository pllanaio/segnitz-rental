import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '@/lib/api/client';
import { OrdersView } from './orders-view';

vi.mock('@/lib/api/client', () => ({
  apiGet: vi.fn(),
  apiJson: vi.fn(),
  apiRequest: vi.fn(),
}));

describe('admin order filters', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset().mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
      filterOptions: {
        years: ['2026'],
        months: ['01'],
        statuses: [],
        returnStatuses: [],
        paymentStatuses: [],
      },
    });
  });

  it('enables month filtering only with a year and clears it together with the year', async () => {
    render(<OrdersView notify={vi.fn(() => 1)} />);

    const year = screen.getByLabelText('Jahr');
    const month = screen.getByLabelText('Monat');
    expect(month).toBeDisabled();

    await waitFor(() => expect(year).toHaveTextContent('2026'));
    fireEvent.change(year, { target: { value: '2026' } });
    expect(month).toBeEnabled();

    fireEvent.change(month, { target: { value: '01' } });
    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.some(([url]) => (
      String(url).includes('year=2026') && String(url).includes('month=01')
    ))).toBe(true));

    const callsBeforeClear = vi.mocked(apiGet).mock.calls.length;
    fireEvent.change(year, { target: { value: '' } });
    expect(month).toBeDisabled();
    expect(month).toHaveValue('');

    await waitFor(() => expect(vi.mocked(apiGet).mock.calls.length).toBeGreaterThan(callsBeforeClear));
    const [requestAfterClear] = vi.mocked(apiGet).mock.calls.at(-1) ?? [];
    expect(String(requestAfterClear)).not.toContain('year=');
    expect(String(requestAfterClear)).not.toContain('month=');
  });
});
