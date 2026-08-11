import { budgetedTurn, runTurnWithBudget } from "@src/sessions/budget-runner";

describe("runTurnWithBudget", () => {
  it("completes normally when token usage stays below the configured budget", async () => {
    const agent = {
      openTask: jest.fn().mockResolvedValue(undefined),
      stream: () =>
        (async function* () {
          yield { usage: { input_tokens: 10, output_tokens: 5 } };
          yield { type: "session.status_idle" };
        })(),
      interrupt: jest.fn().mockResolvedValue(undefined),
    };

    const result = await runTurnWithBudget(agent, "inspect the issue", {
      maxTokens: 100,
    });

    expect(result).toEqual({ status: "completed", spent: 15 });
    expect(agent.interrupt).not.toHaveBeenCalled();
  });

  it("interrupts the turn when the budget is exceeded and reports warnings", async () => {
    const onWarning = jest.fn();
    const onInterrupt = jest.fn();
    const agent = {
      openTask: jest.fn().mockResolvedValue(undefined),
      stream: () =>
        (async function* () {
          yield { usage: { input_tokens: 80, output_tokens: 20 } };
          yield { type: "session.status_idle" };
        })(),
      interrupt: jest.fn().mockResolvedValue(undefined),
    };

    const result = await runTurnWithBudget(
      agent,
      "inspect the issue",
      { maxTokens: 100, warningThreshold: 80 },
      { onWarning, onInterrupt },
    );

    expect(result).toEqual({ status: "budget_exceeded", spent: 100 });
    expect(onWarning).toHaveBeenCalledWith(100, 100);
    expect(onInterrupt).toHaveBeenCalledWith(100, 100);
    expect(agent.interrupt).toHaveBeenCalledTimes(1);
  });

  it("supports the alternate budgetedTurn API with warning and cutoff hooks", async () => {
    const onWarn = jest.fn();
    const onCutoff = jest.fn();
    const agent = {
      begin: jest.fn().mockResolvedValue(undefined),
      pull: () =>
        (async function* () {
          yield { usage: { prompt: 80, completion: 20 } };
          yield { kind: "session.idle" };
        })(),
      stop: jest.fn().mockResolvedValue(undefined),
    };

    const result = await budgetedTurn(
      agent,
      "inspect the issue",
      { limit: 100, warnAt: 80 },
      { onWarn, onCutoff },
    );

    expect(result).toEqual({ outcome: "cutoff", spent: 100 });
    expect(onWarn).toHaveBeenCalledWith(100, 100);
    expect(onCutoff).toHaveBeenCalledWith(100, 100);
    expect(agent.stop).toHaveBeenCalledTimes(1);
  });
});
