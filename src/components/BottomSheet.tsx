import { useRef, useCallback, useEffect, useState, type ReactNode } from 'react';
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
  const draggedRef = useRef(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useEffect(() => {
    const resize = () => setViewportHeight(window.visualViewport?.height ?? window.innerHeight);
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  const expandedHeight = Math.max(minHeight, Math.min(maxHeight, viewportHeight - 64));
  const readingHeight = Math.min(defaultHeight, expandedHeight);

  // If an initialHeight is provided, offset y so the sheet starts at that height
  // height = defaultHeight - y  =>  y = defaultHeight - initialHeight
  const clampedInitial = initialHeight
    ? Math.max(minHeight, Math.min(expandedHeight, initialHeight))
    : readingHeight;
  const y = useMotionValue(defaultHeight - clampedInitial);
  // height = defaultHeight - y: dragging down (positive y) shrinks, dragging up (negative y) grows
  const height = useTransform(y, (offset) => Math.max(minHeight, Math.min(expandedHeight, defaultHeight - offset)));
  const [sizeLabel, setSizeLabel] = useState('reading');
  const snapTo = useCallback((target: number) => {
    animate(y, defaultHeight - target, SHEET_SPRING);
  }, [y, defaultHeight]);
  const snapAfterDrag = () => {
    const points = [minHeight, readingHeight, expandedHeight];
    const current = height.get();
    snapTo(points.reduce((best, point) => Math.abs(point - current) < Math.abs(best - current) ? point : best));
  };

  const expand = useCallback(() => {
    if (height.get() < SHEET_EXPAND_THRESHOLD) {
      snapTo(readingHeight);
    }
  }, [height, snapTo, readingHeight]);

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
      setSizeLabel(h < (minHeight + readingHeight) / 2 ? 'compact' : h < (readingHeight + expandedHeight) / 2 ? 'reading' : 'expanded');
    });
    return unsubscribe;
  }, [height, onHeightChange, minHeight, readingHeight, expandedHeight]);

  // Handle ESC key to minimize sheet
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !window.history.state?.settingsOpen && !window.history.state?.searchOpen) {
        // Animate to minimized position
        animate(y, defaultHeight - minHeight, SHEET_SPRING);
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [y, defaultHeight, minHeight, onClose]);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      draggedRef.current = false;
      y.stop();
      dragControls.start(event);
    },
    [dragControls, y]
  );

  return (
    <motion.div
      ref={containerRef}
      className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 rounded-t-2xl shadow-sheet z-40 flex flex-col"
      style={{
        height,
        paddingBottom: 'var(--safe-area-inset-bottom)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Tap cycles sizes; dragging snaps to the nearest size. */}
      <button
        type="button"
        aria-label={`Sheet ${sizeLabel}. Change sheet size`}
        title="Tap to resize, or drag"
        className="flex justify-center items-center min-h-8 shrink-0 cursor-grab active:cursor-grabbing touch-none rounded-t-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
        onPointerDown={startDrag}
        onClick={() => {
          if (draggedRef.current) { draggedRef.current = false; return; }
          const current = height.get();
          snapTo(current < readingHeight - 2 ? readingHeight : current < expandedHeight - 2 ? expandedHeight : minHeight);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            snapTo(event.key === 'ArrowUp' ? expandedHeight : minHeight);
          }
        }}
      >
        <span className="sheet-handle" />
      </button>

      {/* Invisible drag tracker - doesn't move visually, just tracks y for height */}
      <motion.div
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: defaultHeight - expandedHeight, bottom: defaultHeight - minHeight }}
        onDragStart={() => { draggedRef.current = true; }}
        onDragEnd={snapAfterDrag}
        dragElastic={0}
        dragMomentum={false}
        style={{ y }}
        className="sr-only"
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 flex flex-col">
        {/* Fixed header */}
        {header && <div className="shrink-0">{header}</div>}
        {/* Scrollable content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin min-h-0 relative">{children}</div>
      </div>
    </motion.div>
  );
};
