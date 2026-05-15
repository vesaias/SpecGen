import TiptapEditor from "../TiptapEditor";

interface Props {
  content: string;
  variant: "info" | "warning" | "tip";
  editable: boolean;
  onChange: (content: string) => void;
}

const VARIANTS = {
  info: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    icon: "ℹ️",
    text: "text-blue-800 dark:text-blue-200",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950",
    border: "border-amber-200 dark:border-amber-800",
    icon: "⚠️",
    text: "text-amber-800 dark:text-amber-200",
  },
  tip: {
    bg: "bg-green-50 dark:bg-green-950",
    border: "border-green-200 dark:border-green-800",
    icon: "💡",
    text: "text-green-800 dark:text-green-200",
  },
};

export default function CalloutBlock({ content, variant, editable, onChange }: Props) {
  const v = VARIANTS[variant] || VARIANTS.info;

  return (
    <div className={`${v.bg} ${v.border} border rounded-lg p-4 flex gap-3`}>
      <span className="text-lg flex-shrink-0">{v.icon}</span>
      <div className={`flex-1 text-sm ${v.text}`}>
        <TiptapEditor
          content={content}
          onChange={onChange}
          editable={editable}
          placeholder="Add a note..."
        />
      </div>
    </div>
  );
}
