import TiptapEditor from "../TiptapEditor";

interface Props {
  content: string;
  editable: boolean;
  onChange: (content: string) => void;
}

export default function RichtextBlock({ content, editable, onChange }: Props) {
  return (
    <TiptapEditor
      content={content}
      onChange={onChange}
      editable={editable}
      placeholder="Type '/' for commands..."
    />
  );
}
