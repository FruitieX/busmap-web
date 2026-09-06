interface DetailBackButtonProps {
  label: string;
  onClick: () => void;
}

export const DetailBackButton = ({ label, onClick }: DetailBackButtonProps) => (
  <button type="button" onClick={onClick} className="flex items-center gap-1.5 max-w-full min-h-9 mb-2 rounded-lg px-1 text-sm text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
    <span className="truncate">{label}</span>
  </button>
);
