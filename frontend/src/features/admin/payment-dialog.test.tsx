import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PaymentDialog } from './payment-dialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

describe('manual payment dialog', () => {
  it('keeps the server-derived amount read-only and submits it unchanged', async () => {
    const action = {
      mode: 'payment' as const,
      orderId: 7,
      orderItemId: 12,
      paymentType: 'rental_adjustment',
      amount: 23.45,
    };
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<PaymentDialog action={action} onClose={vi.fn()} onSubmit={onSubmit} />);

    const amount = screen.getByLabelText('Betrag *');
    expect(amount).toHaveAttribute('readonly');
    expect(amount).toHaveValue('23.45');

    fireEvent.click(screen.getByRole('button', { name: 'Zahlung erfassen' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(action, {
      amount: action.amount,
      note: '',
    }));
  });
});
