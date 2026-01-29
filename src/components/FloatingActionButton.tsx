import { memo, type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface FloatingActionButtonProps {
  icon: ReactNode;
  onClick: () => void;
  label?: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'w-10 h-10',
  md: 'w-12 h-12',
  lg: 'w-14 h-14',
};

const iconSizes = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
  lg: 'w-7 h-7',
};

const FloatingActionButtonComponent = ({
  icon,
  onClick,
  label,
  variant = 'secondary',
  size = 'md',
  className = '',
}: FloatingActionButtonProps) => {
  const baseClasses = `
    ${sizes[size]}
    rounded-full
    flex items-center justify-center
    shadow-float
    transition-colors
    active:scale-95
  `;

  const variantClasses =
    variant === 'primary'
      ? 'bg-primary-500 text-white hover:bg-primary-600'
      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700';

  return (
    <motion.button
      className={`${baseClasses} ${variantClasses} ${className}`}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      aria-label={label}
      title={label}
    >
      <span className={iconSizes[size]}>{icon}</span>
    </motion.button>
  );
};

export const FloatingActionButton = memo(FloatingActionButtonComponent);
