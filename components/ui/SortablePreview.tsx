'use client';

import React from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';

/**
 * Touch-safe sensor configuration for @dnd-kit:
 * - PointerSensor requires 6px movement before drag starts (never hijacks clicks).
 * - TouchSensor requires 180ms hold with 8px tolerance (never blocks mobile vertical scrolling).
 * - KeyboardSensor supports Space/Enter + Arrow keys for accessibility.
 */
export function useTouchSafeSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
}

export interface SortablePreviewItemProps {
  id: string;
  dragData?: Record<string, unknown>;
  /** Label for screen readers on the explicit drag handle */
  dragLabel?: string;
  /** Render function receives explicit drag-handle attributes/listeners so only the grip initiates drag */
  children: (controls: {
    dragHandleProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
    isDragging: boolean;
  }) => React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function SortablePreviewItem({
  id,
  dragData,
  dragLabel = 'Drag to reorder',
  children,
  className = '',
  disabled = false,
}: SortablePreviewItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    data: dragData,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.55 : 1,
  };

  const dragHandleProps: React.ButtonHTMLAttributes<HTMLButtonElement> = {
    ...attributes,
    ...listeners,
    type: 'button',
    'aria-label': dragLabel,
    title: dragLabel,
    style: { touchAction: 'none' },
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative ${isDragging ? 'ring-2 ring-[var(--ps-accent)]/60 rounded-2xl' : ''} ${className}`}
    >
      {children({ dragHandleProps, isDragging })}
    </div>
  );
}

export interface DragHandleButtonProps {
  handleProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
  compact?: boolean;
  className?: string;
}

export function DragHandleButton({
  handleProps,
  compact = false,
  className = '',
}: DragHandleButtonProps) {
  return (
    <button
      {...handleProps}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] transition-colors hover:border-[var(--ps-accent)]/60 hover:text-[var(--ps-text)] cursor-grab active:cursor-grabbing ${
        compact ? 'h-9 w-9 min-h-[36px] min-w-[36px]' : 'h-11 w-11 min-h-[44px] min-w-[44px]'
      } ${className}`}
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export interface MobileOrderButtonsProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  itemLabel?: string;
}

export function MobileOrderButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  itemLabel = 'item',
}: MobileOrderButtonsProps) {
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={!canMoveUp}
        onClick={onMoveUp}
        aria-label={`Move ${itemLabel} up`}
        title="Move earlier"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] disabled:opacity-35 cursor-pointer"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={!canMoveDown}
        onClick={onMoveDown}
        aria-label={`Move ${itemLabel} down`}
        title="Move later"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] disabled:opacity-35 cursor-pointer"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export interface DroppableContainerZoneProps {
  id: string;
  data?: Record<string, unknown>;
  children: (state: { isOver: boolean }) => React.ReactNode;
  className?: string;
}

export function DroppableContainerZone({
  id,
  data,
  children,
  className = '',
}: DroppableContainerZoneProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data });

  return (
    <div ref={setNodeRef} className={className}>
      {children({ isOver })}
    </div>
  );
}
