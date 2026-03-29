import type { ButtonHTMLAttributes, ReactNode } from "react";

const variants = {
  primary:
    "bg-ecit-dark text-white hover:bg-ecit-navy focus:ring-ecit-navy",
  secondary:
    "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-300",
  gold:
    "bg-ecit-gold text-white hover:bg-ecit-gold-dark focus:ring-ecit-gold",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
  green:
    "bg-green-600 text-white hover:bg-green-700 focus:ring-green-500",
  ghost:
    "bg-white/10 text-white hover:bg-white/20 focus:ring-white/30",
  link:
    "text-ecit-navy hover:underline !p-0 !rounded-none !shadow-none focus:ring-0",
} as const;

const sizes = {
  sm: "px-3 py-1 text-xs",
  md: "px-4 py-2.5 text-sm",
} as const;

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  icon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  shadow?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  fullWidth = false,
  shadow = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        shadow && "shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : icon ? (
        icon
      ) : null}
      {children}
    </button>
  );
}
