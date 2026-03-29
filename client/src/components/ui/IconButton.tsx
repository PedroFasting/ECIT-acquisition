import type { ButtonHTMLAttributes, ReactNode } from "react";

const variants = {
  default:
    "text-gray-400 hover:text-gray-600 hover:bg-gray-100",
  danger:
    "text-gray-400 hover:text-red-600 hover:bg-red-50",
} as const;

const sizes = {
  sm: "p-1.5",
  md: "p-2",
} as const;

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export default function IconButton({
  icon,
  variant = "default",
  size = "sm",
  className = "",
  ...rest
}: IconButtonProps) {
  return (
    <button
      className={[
        "rounded-lg transition-colors",
        variants[variant],
        sizes[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {icon}
    </button>
  );
}
