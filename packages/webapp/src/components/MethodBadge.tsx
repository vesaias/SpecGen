const COLORS: Record<string, string> = {
  GET: "bg-blue-500",
  POST: "bg-green-500",
  PUT: "bg-amber-500",
  DELETE: "bg-red-500",
  PATCH: "bg-teal-500",
};

const SIZES = {
  sm: "text-[9px] font-bold px-1.5 py-0.5 min-w-[28px]",
  md: "text-xs font-bold px-3 py-1.5 tracking-wide",
} as const;

interface Props {
  method: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export default function MethodBadge({ method, size = "sm", className }: Props) {
  const color = COLORS[method] || "bg-gray-400";
  return (
    <span
      className={`${color} ${SIZES[size]} text-white uppercase rounded flex-shrink-0 text-center ${className ?? ""}`}
    >
      {method}
    </span>
  );
}
