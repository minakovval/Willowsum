import { useId } from "react";
import { useT } from "@willowsum/i18n";
import { Icon } from "../icons/Icon.tsx";
import { SearchSelect } from "./SearchSelect.tsx";
import {
  pressHitArea,
  SelectFrame,
  selectVariant,
  type FieldStateProps,
  type SelectOption,
} from "./listbox.tsx";

export interface SelectProps extends FieldStateProps {
  options: readonly SelectOption[];
  /** The chosen value; `""` — nothing chosen yet («Оберіть…»). */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
}

/**
 * CMP-03@PoC Select: one value of a short list, the system way — a native `select` with the label above it, a
 * 16 px chevron, the hint or the error below. Arrows change the choice, Space or Alt+↓ open the system list, Esc
 * closes it. A list of more than 8 choices is the «з пошуком» variant (`SearchSelect`), chosen here so a long
 * list never reaches the native element (AC4).
 */
export function Select(props: SelectProps) {
  const { options, value, onChange, name, id, placeholder, required, disabled } = props;
  const t = useT();
  const auto = useId();
  if (selectVariant(options.length) === "search") {
    return <SearchSelect {...props} groups={[{ id: "all", title: "", options }]} />;
  }
  return (
    <SelectFrame base={id ?? `ws-select${auto}`} props={props}>
      {({ control, describedBy, invalid }) => (
        <span className="ws-select-box" onMouseDown={pressHitArea}>
          <select
            id={control}
            name={name}
            className={value === "" ? "ws-select-control ws-select-control--empty" : "ws-select-control"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            aria-required={required || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            disabled={disabled}
          >
            <option value="" disabled={required}>
              {placeholder ?? t("select.placeholder")}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="ws-select-chevron">
            <Icon name="chevron-down" size={16} tone="muted" />
          </span>
        </span>
      )}
    </SelectFrame>
  );
}
