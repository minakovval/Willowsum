import { useId } from "react";

export interface SegmentedOption {
  value: string;
  label: string;
}

/**
 * CMP-12@PoC: a segmented switch of 2–4 visible choices (a native radio group: arrows move and choose, the
 * chosen segment is also marked by weight and a raised tile, not by colour alone). The `legend` is the group's name.
 */
export function Segmented({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="ws-segmented">
      <legend className="ws-segmented-legend ws-visually-hidden">{legend}</legend>
      <div className="ws-segmented-options">
        {options.map((o) => (
          <label key={o.value} className="ws-segmented-option">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
