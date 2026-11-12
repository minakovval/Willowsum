import type { ReactNode } from "react";

/** A translated sentence with one value in bold (the address on S-002 and S-004), without HTML in the catalogue. */
export function withBold(text: string, value: string): ReactNode {
  const at = value === "" ? -1 : text.indexOf(value);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <b>{value}</b>
      {text.slice(at + value.length)}
    </>
  );
}
