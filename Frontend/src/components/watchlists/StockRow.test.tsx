import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { StockRow } from './StockRow';
import type { QuoteState } from '../../types/marketData';
import type { WatchlistStock } from '../../types/watchlist';

const stock: WatchlistStock = {
  id: 's1',
  symbol: 'NVDA',
  company_name: 'NVIDIA Corporation',
  exchange: 'NASDAQ',
  position: 0,
};

function renderRow(quote?: QuoteState) {
  return render(
    <DndContext>
      <SortableContext items={[stock.id]}>
        <StockRow stock={stock} quote={quote} onRemove={vi.fn()} />
      </SortableContext>
    </DndContext>,
  );
}

describe('StockRow quote display', () => {
  it('renders nothing quote-related when no quote prop is given', () => {
    renderRow(undefined);
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('renders a loading skeleton while the quote is loading', () => {
    const { container } = renderRow({ status: 'loading' });
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('renders formatted price, signed change, and change percent', () => {
    renderRow({
      status: 'success',
      data: {
        symbol: 'NVDA',
        price: '1322.0',
        previous_close: '1302.5',
        day_high: '1333.0',
        day_low: '1304.10',
        volume: 13022095,
        average_volume: 12537650,
        change: '19.5',
        change_percent: '1.5',
        timestamp: '2026-01-05T10:00:00Z',
        data_source: 'Yahoo Finance',
        is_delayed: false,
      },
    });

    expect(screen.getByText('₹1,322.00')).toBeInTheDocument();
    expect(screen.getByText('+₹19.50 (+1.50%)')).toBeInTheDocument();
    expect(screen.getByText(/H ₹1,333.00/)).toBeInTheDocument();
    expect(screen.getByText(/L ₹1,304.10/)).toBeInTheDocument();
    expect(screen.getByText(/Vol 1.30Cr/)).toBeInTheDocument();
    expect(screen.queryByText('Delayed')).not.toBeInTheDocument();
  });

  it('colors a negative change using the danger token and shows the delayed tag', () => {
    renderRow({
      status: 'success',
      data: {
        symbol: 'NVDA',
        price: '1280.0',
        previous_close: '1302.5',
        day_high: null,
        day_low: null,
        volume: null,
        average_volume: null,
        change: '-22.5',
        change_percent: '-1.73',
        timestamp: '2026-01-05T10:00:00Z',
        data_source: 'Yahoo Finance',
        is_delayed: true,
      },
    });

    expect(screen.getByText('Delayed')).toBeInTheDocument();
    expect(screen.getByText('-₹22.50 (-1.73%)')).toBeInTheDocument();
    // No H/L/Vol segments should render when the backend didn't provide them.
    expect(screen.queryByText(/^H /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^L /)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Vol /)).not.toBeInTheDocument();
  });

  it('renders an unavailable message for a failed quote, with no fake price', () => {
    renderRow({ status: 'error', message: 'Unavailable' });
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});
