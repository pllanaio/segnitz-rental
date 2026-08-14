import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderFilters } from './profile-types';
import { OrdersPanel } from './orders-panel';

const DATA = {
  items: [],
  pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
  filterOptions: {
    years: ['2026'],
    months: ['08'],
    statuses: [],
    returnStatuses: [],
    paymentStatuses: [],
  },
};

afterEach(cleanup);

function FilterHarness({ onChange }: { onChange: (filters: OrderFilters) => void }) {
  const [filters, setFilters] = useState<OrderFilters>({
    year: '2026',
    month: '08',
    status: '',
    returnStatus: '',
    paymentStatus: '',
  });

  function changeFilters(nextFilters: OrderFilters) {
    setFilters(nextFilters);
    onChange(nextFilters);
  }

  return (
    <OrdersPanel
      data={DATA}
      filters={filters}
      loading={false}
      onChangeFilters={changeFilters}
      onChangePage={vi.fn()}
      onOpenOrder={vi.fn()}
      onRetry={vi.fn()}
      page={1}
    />
  );
}

describe('profile order filters', () => {
  it('clears and disables the month when the year is cleared', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FilterHarness onChange={onChange} />);

    const year = screen.getByLabelText('Jahr');
    const month = screen.getByLabelText('Monat');
    expect(month).toBeEnabled();
    expect(month).toHaveValue('08');

    await user.selectOptions(year, '');

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ year: '', month: '' }));
    expect(month).toBeDisabled();
    expect(month).toHaveValue('');
  });

  it('starts with the month disabled when no year is selected', () => {
    render(
      <OrdersPanel
        data={DATA}
        filters={{ year: '', month: '', status: '', returnStatus: '', paymentStatus: '' }}
        loading={false}
        onChangeFilters={vi.fn()}
        onChangePage={vi.fn()}
        onOpenOrder={vi.fn()}
        onRetry={vi.fn()}
        page={1}
      />,
    );

    expect(screen.getByLabelText('Monat')).toBeDisabled();
  });
});
