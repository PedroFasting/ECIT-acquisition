import { ChevronDown, ChevronUp } from "lucide-react";

interface SectionHeaderProps {
  sectionKey: string;
  title: string;
  subtitle?: string;
  dark?: boolean;
  actions?: React.ReactNode;
  expanded: boolean;
  onToggle: (key: string) => void;
}

export default function SectionHeader({
  sectionKey,
  title,
  subtitle,
  dark,
  actions,
  expanded,
  onToggle,
}: SectionHeaderProps) {
  return (
    <div
      className={`px-6 py-4 flex items-center justify-between cursor-pointer select-none ${
        dark
          ? "bg-[#03223F] text-white rounded-t-xl"
          : "bg-gray-50 border-b border-gray-200 rounded-t-xl"
      }`}
      onClick={() => onToggle(sectionKey)}
    >
      <div className="flex items-center gap-3">
        <h3 className={`text-sm font-semibold ${dark ? "text-white" : "text-gray-900"}`}>
          {title}
        </h3>
        {subtitle && (
          <span className={`text-xs ${dark ? "text-gray-300" : "text-gray-500"}`}>
            {subtitle}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {actions}
        <button
          onClick={() => onToggle(sectionKey)}
          className={`p-1 rounded ${dark ? "hover:bg-white/10" : "hover:bg-gray-200"}`}
        >
          {expanded ? (
            <ChevronUp size={16} className={dark ? "text-gray-300" : "text-gray-500"} />
          ) : (
            <ChevronDown size={16} className={dark ? "text-gray-300" : "text-gray-500"} />
          )}
        </button>
      </div>
    </div>
  );
}
