import { memo, useState, useEffect, useRef, useCallback } from 'react';

/** Time in ms before the confirm state auto-resets. */
const CONFIRM_TIMEOUT_MS = 3000;

interface ConfirmDeleteButtonProps {
  /** Called when deletion is confirmed (second tap on mobile, or click in confirm state). */
  onConfirm: () => void;
  /** Optional title for accessibility. */
  title?: string;
}

/**
 * A two-tap delete button for mobile-friendly deletion.
 *
 * Initial state: green checkmark (subscribed indicator).
 * First tap: enters confirm state showing red X icon.
 * Second tap (within timeout): fires onConfirm.
 * Auto-resets after CONFIRM_TIMEOUT_MS if no second tap.
 *
 * On desktop, hover still previews the red X via CSS, but deletion
 * always requires two clicks for consistency.
 */
const ConfirmDeleteButtonComponent = ({ onConfirm, title = 'Remove' }: ConfirmDeleteButtonProps) => {
  const [confirmPending, setConfirmPending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset confirm state after timeout
  useEffect(() => {
    if (!confirmPending) return;

    timeoutRef.current = setTimeout(() => {
      setConfirmPending(false);
    }, CONFIRM_TIMEOUT_MS);

    return () => clearTimeout(timeoutRef.current);
  }, [confirmPending]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirmPending) {
        setConfirmPending(false);
        onConfirm();
      } else {
        setConfirmPending(true);
      }
    },
    [confirmPending, onConfirm],
  );

  return (
    <button
      className={`group shrink-0 w-8 h-8 min-[425px]:w-10 min-[425px]:h-10 rounded-full flex items-center justify-center transition-colors ${
        confirmPending
          ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
          : 'bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400'
      }`}
      onClick={handleClick}
      title={confirmPending ? 'Tap again to confirm' : title}
    >
      {confirmPending ? (
        /* Red X - confirm state */
        <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : (
        <>
          {/* Checkmark - default state (hidden on hover) */}
          <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5 group-hover:hidden" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          {/* X icon - shown on hover (desktop preview) */}
          <svg className="w-4 h-4 min-[425px]:w-5 min-[425px]:h-5 hidden group-hover:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </>
      )}
    </button>
  );
};

export const ConfirmDeleteButton = memo(ConfirmDeleteButtonComponent);
