/** Test helper: text encoded in a single-byte code page (the reverse of the platform's decoder). */
export function encodeSingleByte(text: string, label: string): Uint8Array {
  const decoder = new TextDecoder(label);
  const reverse = new Map<string, number>();
  for (let b = 0; b < 256; b++) reverse.set(decoder.decode(Uint8Array.of(b)), b);
  return Uint8Array.from(Array.from(text), (c) => {
    const b = reverse.get(c);
    if (b === undefined) throw new Error(`«${c}» has no byte in ${label}`);
    return b;
  });
}

export function utf16(text: string, order: "le" | "be", bom: boolean): Uint8Array {
  const out: number[] = bom ? (order === "le" ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const [hi, lo] = [unit >> 8, unit & 0xff];
    out.push(...(order === "le" ? [lo, hi] : [hi, lo]));
  }
  return Uint8Array.from(out);
}
