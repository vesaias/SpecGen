import { useState } from "react";

interface Props {
  content: string;
  editable: boolean;
  onChange: (content: string) => void;
}

export default function CodeBlock({ content, editable, onChange }: Props) {
  const [value, setValue] = useState(content);

  if (editable) {
    return (
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
        className="w-full bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg border border-gray-700 min-h-[100px] resize-y outline-none focus:border-[#6b705c]"
        placeholder="Paste code here..."
        spellCheck={false}
      />
    );
  }

  if (!content) return null;

  return (
    <pre className="bg-[#1e1e2e] text-[#cdd6f4] border border-gray-800 rounded-lg p-4 overflow-x-auto text-sm font-mono leading-relaxed">
      <code>{content}</code>
    </pre>
  );
}
