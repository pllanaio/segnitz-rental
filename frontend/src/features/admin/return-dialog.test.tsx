import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ReturnDialog, returnFileValidationError } from './return-dialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

function imageFile(type: string, size = 1024): File {
  return { name: 'return-image', size, type } as File;
}

describe('return image validation', () => {
  it('allows at most ten JPEG, PNG or WebP files of at most 5 MiB each', () => {
    expect(returnFileValidationError([
      imageFile('image/jpeg'),
      imageFile('image/png'),
      imageFile('image/webp', 5 * 1024 * 1024),
    ])).toBeNull();
    expect(returnFileValidationError(Array.from({ length: 11 }, () => imageFile('image/jpeg'))))
      .toBe('Maximal 10 Rückgabefotos pro Upload.');
    expect(returnFileValidationError([imageFile('image/svg+xml')]))
      .toBe('Rückgabefotos müssen JPEG-, PNG- oder WebP-Dateien sein.');
    expect(returnFileValidationError([imageFile('image/png', (5 * 1024 * 1024) + 1)]))
      .toBe('Jedes Rückgabefoto darf maximal 5 MiB groß sein.');
  });
});

describe('return dialog constraints', () => {
  it('uses the pickup date as minimum return date and an exact image accept list', () => {
    const { container } = render(
      <ReturnDialog
        item={{
          id: 12,
          title: 'Testartikel',
          rentalStart: '2026-08-01',
          rentalEnd: '2026-08-20',
          picked_up_at: '2026-08-11 10:15:00',
          pricePerDay: 10,
          deposit: 100,
        }}
        onClose={vi.fn()}
        onDeleteImage={vi.fn()}
        onSubmit={vi.fn()}
        onUpload={vi.fn()}
        payments={[]}
      />,
    );

    expect(screen.getByLabelText('Rückgabedatum *')).toHaveAttribute('min', '2026-08-11');
    expect(container.querySelector('input[type="file"]'))
      .toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });
});
