interface Props {
  src: string;
  editable: boolean;
  onChange: (src: string) => void;
}

export default function ImageBlock({ src, editable, onChange }: Props) {
  if (!src && !editable) return null;

  return (
    <div>
      {editable && (
        <input
          value={src}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Image URL or path..."
          className="w-full text-xs text-stone-500 dark:text-stone-400 bg-transparent placeholder:text-stone-400 dark:placeholder:text-stone-600 mb-2 outline-none border-b border-stone-200 dark:border-stone-700 focus:border-brand-500 dark:focus:border-brand-400 pb-1"
        />
      )}
      {src && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-stone-400 dark:text-stone-500 hover:text-brand-600 dark:hover:text-brand-300 select-none">
            <span className="group-open:hidden">Show screenshot</span>
            <span className="hidden group-open:inline">Hide screenshot</span>
          </summary>
          <div className="mt-2 border border-stone-200 dark:border-stone-800 rounded-lg overflow-hidden">
            <img
              src={src.startsWith("http") || src.startsWith("/") ? src : `/static/${src}`}
              alt=""
              className="w-full"
            />
          </div>
        </details>
      )}
    </div>
  );
}
