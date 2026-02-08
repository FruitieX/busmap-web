import { useRef, useCallback, useEffect, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, useDragControls, animate, type MotionValue } from 'framer-motion';
import {
  SHEET_MIN_HEIGHT,
  SHEET_MAX_HEIGHT,
  SHEET_DEFAULT_HEIGHT,
  SHEET_EXPAND_THRESHOLD,
  SHEET_SPRING,
} from '@/constants';

interface BottomSheetProps {
  children: ReactNode;
  header?: ReactNode;
  minHeight?: number;
  maxHeight?: number;
  defaultHeight?: number;
  initialHeight?: number;
  onHeightChange?: (height: number) => void;
  onHeightMotionValue?: (mv: MotionValue<number>) => void;
  onClose?: () => void;
  onExpand?: (expand: () => void) => void;
  contentRef?: React.Ref<HTMLDivElement>;
}

export const BottomSheet = ({
  children,
  header,
  minHeight = SHEET_MIN_HEIGHT,
  maxHeight = SHEET_MAX_HEIGHT,
  defaultHeight = SHEET_DEFAULT_HEIGHT,
  initialHeight,
  onHeightChange,
  onHeightMotionValue,
  onClose,
  onExpand,
  contentRef,
}: BottomSheetProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  // If an initialHeight is provided, offset y so the sheet starts at that height
  // height = defaultHeight - y  =>  y = defaultHeight - initialHeight
  const clampedInitial = initialHeight
    ? Math.max(minHeight, Math.min(maxHeight, initialHeight))
    : defaultHeight;
  const y = useMotionValue(defaultHeight - clampedInitial);
  // height = defaultHeight - y: dragging down (positive y) shrinks, dragging up (negative y) grows
  const height = useTransform(y, [defaultHeight - minHeight, -(maxHeight - defaultHeight)], [minHeight, maxHeight]);

  const expand = useCallback(() => {
    if (height.get() < SHEET_EXPAND_THRESHOLD) {
      animate(y, 0, SHEET_SPRING);
    }
  }, [y, height]);

  useEffect(() => {
    onExpand?.(expand);
  }, [expand, onExpand]);

  // Expose height motion value for direct binding
  useEffect(() => {
    onHeightMotionValue?.(height);
  }, [height, onHeightMotionValue]);

  // Report height changes during drag
  useEffect(() => {
    // Report initial height immediately
    onHeightChange?.(height.get());
    const unsubscribe = height.on('change', (h) => {
      onHeightChange?.(h);
    });
    return unsubscribe;
  }, [height, onHeightChange]);

  // Handle ESC key to minimize sheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Animate to minimized position
        animate(y, defaultHeight - minHeight, SHEET_SPRING);
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [y, maxHeight, minHeight, onClose]);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      dragControls.start(event);
    },
    [dragControls]
  );

  return (
    <motion.div
      ref={containerRef}
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-sheet z-40"
      style={{
        height,
        paddingBottom: 'var(--safe-area-inset-bottom)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Drag handle - visual only */}
      <div
        className="flex justify-center py-2 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={startDrag}
      >
        <div className="sheet-handle" />
      </div>

      {/* Invisible drag tracker - doesn't move visually, just tracks y for height */}
      <motion.div
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: -(maxHeight - defaultHeight), bottom: defaultHeight - minHeight }}
        dragElastic={0}
        dragMomentum={false}
        style={{ y }}
        className="sr-only"
      />

      {/* Content */}
      <div className="h-full overflow-hidden px-4 flex flex-col">
        {/* Fixed header */}
        {header && <div className="shrink-0">{header}</div>}
        {/* Scrollable content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto scrollbar-thin min-h-0 relative">{children}</div>
      </div>
    </motion.div>
  );
};
