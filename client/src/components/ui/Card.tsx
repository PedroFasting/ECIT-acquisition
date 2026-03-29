import type { HTMLAttributes, ReactNode } from "react";

const paddingMap = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
} as const;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: keyof typeof paddingMap;
  /** Dashed border empty-state card */
  empty?: boolean;
  /** Hover shadow effect for clickable cards */
  hover?: boolean;
  /** Gray background for inset config panels */
  inset?: boolean;
}

export default function Card({
  children,
  padding = "none",
  empty = false,
  hover = false,
  inset = false,
  className = "",
  ...rest
}: CardProps) {
  if (empty) {
    return (
      <div
        className={[
          "bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={[
        "rounded-xl border border-gray-200",
        inset ? "bg-gray-50" : "bg-white",
        hover && "hover:shadow-md transition-shadow",
        paddingMap[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
