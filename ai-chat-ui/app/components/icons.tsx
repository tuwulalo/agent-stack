interface IconProps {
  size?: number
  className?: string
}

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const PlusIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
)

export const SendIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}><path d="M5 12l14-7-7 14-2-5-5-2z" /></svg>
)

export const StopIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
)

export const TrashIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14" />
  </svg>
)

export const CopyIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)

export const CheckIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}><path d="M20 6L9 17l-5-5" /></svg>
)

export const RefreshIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 12a9 9 0 11-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
)

export const ExternalIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M14 3h7v7M10 14L21 3M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5" />
  </svg>
)

export const TerminalIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 17l6-6-6-6M12 19h8" />
  </svg>
)

export const SparkIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14zM5 16l.6 1.6L7 18l-1.4.4L5 20l-.6-1.6L3 18l1.4-.4L5 16z" />
  </svg>
)
