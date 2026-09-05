import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { StockRow } from './StockRow';
import type { ChangeEventSummary } from '../../types/marketState';
import type { QuoteState } from '../../types/marketData';
import type { WatchlistStock } from '../../types/watchlist';

interface StockListProps {
  stocks: WatchlistStock[];
  quotes: Record<string, QuoteState>;
  onReorder: (newOrder: WatchlistStock[]) => void;
  onRemove: (symbol: string) => void;
  removingSymbol: string | null;
  reordering: boolean;
  newlyAddedId: string | null;
  watchlistId?: string;
  changes?: ChangeEventSummary[];
}

export function StockList({
  stocks,
  quotes,
  onReorder,
  onRemove,
  removingSymbol,
  reordering,
  newlyAddedId,
  watchlistId,
  changes,
}: StockListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = stocks.findIndex((s) => s.id === active.id);
    const newIndex = stocks.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    onReorder(arrayMove(stocks, oldIndex, newIndex));
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <SortableContext items={stocks.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div>
          {stocks.map((stock) => (
            <StockRow
              key={stock.id}
              stock={stock}
              quote={quotes[stock.symbol]}
              onRemove={() => onRemove(stock.symbol)}
              removing={removingSymbol === stock.symbol}
              disabled={reordering}
              isNew={stock.id === newlyAddedId}
              watchlistId={watchlistId}
              changes={changes}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
