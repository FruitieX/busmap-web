import { memo } from 'react';

type StarToggleSize = 'sm' | 'md' | 'lg';

interface StarToggleButtonProps {
  active: boolean;
  onToggle: () => void;
  /** Accessible title for the button. */
  title?: string;
  /** Button/icon size variant. */
  size?: StarToggleSize;
}

const sizeClasses: Record<StarToggleSize, { button: string; icon: string }> = {
  sm: {
    button: 'w-7 h-7',
    icon: 'w-3.5 h-3.5',
  },
  md: {
    button: 'w-8 h-8',
    icon: 'w-4 h-4',
  },
  lg: {
    button: 'w-8 h-8 min-[425px]:w-10 min-[425px]:h-10',
    icon: 'w-4 h-4 min-[425px]:w-5 min-[425px]:h-5',
  },
};

/**
 * A star toggle button for subscribing/unsubscribing to routes and stops.
 * Shows a filled star when active, an outlined star when inactive.
 */
const StarToggleButtonComponent = ({ active, onToggle, title, size = 'lg' }: StarToggleButtonProps) => {
  const { button, icon } = sizeClasses[size];

  return (
    <button
      className={`shrink-0 ${button} rounded-full flex items-center justify-center transition-colors ${
        active
          ? 'bg-primary-100 dark:bg-primary-900 text-primary-600 dark:text-primary-400'
          : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-primary-100 dark:hover:bg-primary-900 hover:text-primary-600 dark:hover:text-primary-400'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={title}
    >
      {active ? (
        <svg className={icon} fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ) : (
        <svg className={icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      )}
    </button>
  );
};

export const StarToggleButton = memo(StarToggleButtonComponent);
