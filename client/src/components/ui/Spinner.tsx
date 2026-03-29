const sizeMap = {
  sm: "w-4 h-4 border-2",
  md: "w-6 h-6 border-2",
  lg: "w-8 h-8 border-[3px]",
} as const;

const colorMap = {
  navy: "border-ecit-navy border-t-transparent",
  gray: "border-gray-300 border-t-transparent",
  white: "border-white border-t-transparent",
} as const;

export interface SpinnerProps {
  size?: keyof typeof sizeMap;
  color?: keyof typeof colorMap;
  /** Text label shown below the spinner */
  label?: string;
  /** Wraps in a full-page centered container (replaces page loading states) */
  fullPage?: boolean;
  className?: string;
}

function SpinnerCircle({
  size = "md",
  color = "navy",
  className = "",
}: Pick<SpinnerProps, "size" | "color" | "className">) {
  return (
    <div
      className={[
        "rounded-full animate-spin",
        sizeMap[size],
        colorMap[color],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export default function Spinner({
  size = "md",
  color = "navy",
  label,
  fullPage = false,
  className = "",
}: SpinnerProps) {
  if (fullPage) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full gap-3">
        <SpinnerCircle size={size} color={color} className={className} />
        {label && <p className="text-gray-400 text-sm">{label}</p>}
      </div>
    );
  }

  if (label) {
    return (
      <div className="flex items-center gap-2">
        <SpinnerCircle size={size} color={color} className={className} />
        <span className="text-gray-400 text-sm">{label}</span>
      </div>
    );
  }

  return <SpinnerCircle size={size} color={color} className={className} />;
}

export { SpinnerCircle };
