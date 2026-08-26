import { describe, expect, expectTypeOf, it } from "vitest";

import { createStateMachine } from "../../src/ui/createStateMachine";

describe("createStateMachine", () => {
  it("updates nested state through store setter callbacks", () => {
    const [state, actions] = createStateMachine(
      { context: { name: "initial" }, count: 0 },
      {
        setName(state, name: string) {
          state.context.name = name;
        },
        increment(state, amount: number) {
          state.count += amount;
        },
        reset(state) {
          state.context.name = "initial";
          state.count = 0;
        },
      },
    );

    expectTypeOf(actions.setName).toEqualTypeOf<(name: string) => void>();
    expectTypeOf(actions.increment).toEqualTypeOf<(amount: number) => void>();
    expectTypeOf(actions.reset).toEqualTypeOf<() => void>();

    expect(actions.setName("updated")).toBeUndefined();
    actions.increment(2);

    expect(state.context.name).toBe("updated");
    expect(state.count).toBe(2);

    actions.reset();

    expect(state.context.name).toBe("initial");
    expect(state.count).toBe(0);
  });

  it("preserves readonly state fields in action drafts", () => {
    const initial: { readonly context: { readonly name: string } } = {
      context: { name: "initial" },
    };

    const [state] = createStateMachine(initial, {
      inspect(draft) {
        expectTypeOf(draft).toEqualTypeOf<typeof initial>();
      },
    });

    expect(state.context.name).toBe("initial");
  });
});
