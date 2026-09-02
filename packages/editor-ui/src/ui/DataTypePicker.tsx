import type { DataType } from "@macrograph/plugin/DataType";

import * as stylex from "@stylexjs/stylex";
import { createMemo, createSignal, Show } from "solid-js";

import { colors } from "../tokens.stylex.ts";
import { Select } from "./Select";
import {
  choiceKey,
  choiceLabel,
  filterTypeChoices,
  replaceTypeSegment,
  typeLabel,
  typeSegments,
} from "./typeSelection";

const styles = stylex.create({
  root: { minWidth: 0 },
  segments: {
    alignItems: "center",
    backgroundColor: "black",
    borderRadius: 8,
    display: "flex",
    flexWrap: "nowrap",
    fontFamily: "monospace",
    fontSize: 14,
    overflowX: "auto",
    overflowY: "hidden",
    paddingBlock: 1,
  },
  segmentFrame: {
    alignItems: "center",
    backgroundColor: "black",
    borderColor: "#404040",
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    display: "flex",
    flexShrink: 0,
    flexWrap: "nowrap",
    cursor: "pointer",
    marginBlock: -1,
    paddingInline: 4,
  },
  segment: {
    backgroundColor: "transparent",
    color: colors.gray12,
    maxWidth: "100%",
    outline: "none",
    overflowWrap: "anywhere",
    padding: 4,
    ":focus-visible": { color: colors.focus },
    "@media (pointer: coarse)": { minHeight: 36 },
  },
  hovered: {
    backgroundColor: "color-mix(in srgb, var(--yellow-9, #eab308) 20%, black)",
    borderColor: "#eab308",
  },
});

export interface DataTypePickerProps {
  readonly value: DataType.Any;
  readonly definitions?: DataType.Definitions;
  readonly onChange: (type: DataType.Any) => void;
  readonly label?: string;
  readonly disabled?: boolean;
}

export function DataTypePicker(props: DataTypePickerProps) {
  const [hoveredDepth, setHoveredDepth] = createSignal<number | null>(null);
  const [selectedDepth, setSelectedDepth] = createSignal<number | null>(null);
  const segments = createMemo(() => typeSegments(props.value));
  const choices = createMemo(() => filterTypeChoices("", props.definitions));
  const options = createMemo(() =>
    choices().map((choice) => ({
      id: choiceKey(choice),
      name: choiceLabel(choice, props.definitions),
      group:
        typeof choice === "string"
          ? choice === "List" || choice === "Option"
            ? "Containers"
            : "Primitives"
          : props.definitions?.[choice.id]?._tag === "Enum"
            ? "Enums"
            : "Structs",
    })),
  );
  const segmentLabel = (index: number) => {
    const segment = segments()[index];
    return segment?._tag === "Custom" ? typeLabel(segment, props.definitions) : segment?._tag;
  };

  function Segment(segmentProps: { index: number }) {
    const value = () => {
      const segment = segments()[segmentProps.index];
      return segment?._tag === "Custom" ? choiceKey(segment) : (segment?._tag ?? "");
    };
    return (
      <div
        sx={[
          styles.segmentFrame,
          hoveredDepth() === segmentProps.index || selectedDepth() === segmentProps.index
            ? styles.hovered
            : null,
        ]}
        onMouseMove={(event) => {
          event.stopPropagation();
          setHoveredDepth(segmentProps.index);
        }}
        onMouseLeave={(event) => {
          event.stopPropagation();
          setHoveredDepth(null);
        }}
      >
        <Select
          options={options()}
          value={value()}
          valid
          disabled={props.disabled ?? false}
          searchable
          menuMinWidth={192}
          placeholder="Select a data type"
          onOpenChange={(open) => setSelectedDepth(open ? segmentProps.index : null)}
          onChange={(id) => {
            const choice = choices().find((choice) => choiceKey(choice) === id);
            if (choice) props.onChange(replaceTypeSegment(props.value, segmentProps.index, choice));
          }}
          trigger={(trigger) => (
            <button
              ref={trigger.ref}
              type="button"
              disabled={trigger.disabled()}
              data-type-depth={segmentProps.index}
              sx={styles.segment}
              aria-label={`${props.label ?? "Data type"}, ${segmentProps.index === 0 ? "outer" : `nested ${segmentProps.index}`}: ${segmentLabel(segmentProps.index)}`}
              title={
                segments()[segmentProps.index]?._tag === "Custom"
                  ? choiceKey(segments()[segmentProps.index] as DataType.Custom)
                  : undefined
              }
              aria-haspopup="listbox"
              aria-expanded={trigger.isOpen() ? "true" : "false"}
              onClick={trigger.toggle}
            >
              {segmentLabel(segmentProps.index)}
            </button>
          )}
        />
        <Show when={segmentProps.index + 1 < segments().length}>
          <Segment index={segmentProps.index + 1} />
        </Show>
      </div>
    );
  }

  return (
    <div
      sx={styles.root}
      data-component="data-type-picker"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div sx={styles.segments} role="group" aria-label={props.label ?? "Data type"}>
        <Segment index={0} />
      </div>
    </div>
  );
}
