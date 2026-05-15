import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "brand" | "danger";
type Size = "sm" | "md";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** When true, renders pressed/active state (useful for toggles). */
  pressed?: boolean;
}

// Primary: solid contrast (inverted in dark mode).
// Secondary: outlined card.
// Ghost: text-only with subtle hover.
// Brand: brand-olive solid (kept as-is across modes — brand color reads OK on both).
// Danger: outlined red — non-disabled-looking even at rest.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-stone-900 text-white border border-stone-900 hover:bg-stone-700 hover:border-stone-700 " +
    "dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100 dark:hover:bg-stone-300 dark:hover:border-stone-300",
  secondary:
    "bg-white text-stone-700 border border-stone-300 hover:border-stone-500 hover:text-stone-900 " +
    "dark:bg-stone-900 dark:text-stone-300 dark:border-stone-700 dark:hover:border-stone-500 dark:hover:text-stone-100",
  ghost:
    "bg-transparent text-stone-600 border border-transparent hover:text-stone-900 hover:bg-stone-100 " +
    "dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-stone-800",
  brand:
    "bg-brand text-white border border-brand hover:bg-brand-700 hover:border-brand-700 " +
    "dark:bg-brand-500 dark:border-brand-500 dark:hover:bg-brand-400 dark:hover:border-brand-400",
  danger:
    "bg-white text-red-700 border border-red-300 hover:bg-red-50 hover:border-red-400 " +
    "dark:bg-stone-900 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-950 dark:hover:border-red-700",
};

const PRESSED: Record<Variant, string> = {
  primary: "bg-stone-700 border-stone-700 dark:bg-stone-300 dark:border-stone-300",
  secondary:
    "bg-stone-50 border-stone-500 text-stone-900 dark:bg-stone-800 dark:border-stone-500 dark:text-stone-100",
  ghost: "bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-stone-100",
  brand: "bg-brand-700 border-brand-700 dark:bg-brand-400 dark:border-brand-400",
  danger: "bg-red-50 border-red-400 dark:bg-red-950 dark:border-red-700",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-[11px] font-medium rounded-md",
  md: "px-3 py-1.5 text-sm font-medium rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", pressed, className, type, ...rest },
  ref,
) {
  const variantClass = pressed ? `${VARIANTS[variant]} ${PRESSED[variant]}` : VARIANTS[variant];
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={`${variantClass} ${SIZES[size]} transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-950 ${className ?? ""}`}
      {...rest}
    />
  );
});
