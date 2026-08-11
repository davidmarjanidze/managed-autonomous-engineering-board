export type BudgetPolicy = {
  maxTokens: number;
  warningThreshold?: number;
};

export type EventLike = {
  type?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

export type AgentHandle = {
  openTask: (prompt: string) => Promise<void>;
  stream: () => AsyncIterable<EventLike>;
  interrupt: () => Promise<void>;
};

export type BudgetRules = {
  limit: number;
  warnAt?: number;
};

export type StreamEvent = {
  kind?: string;
  usage?: {
    prompt?: number;
    completion?: number;
  };
};

export type AgentRunner = {
  begin: (prompt: string) => Promise<void>;
  pull: () => AsyncIterable<StreamEvent>;
  stop: () => Promise<void>;
};

export type BudgetHooks = {
  onWarn?: (spent: number, limit: number) => void | Promise<void>;
  onCutoff?: (spent: number, limit: number) => void | Promise<void>;
};

function extractTokenDelta(event: EventLike): number {
  const input = event.usage?.input_tokens ?? 0;
  const output = event.usage?.output_tokens ?? 0;
  return input + output;
}

export async function budgetedTurn(
  agent: AgentRunner,
  prompt: string,
  rules: BudgetRules,
  hooks?: BudgetHooks,
): Promise<{ outcome: "completed" | "cutoff"; spent: number }> {
  let spent = 0;

  await agent.begin(prompt);

  for await (const event of agent.pull()) {
    const delta = (event.usage?.prompt ?? 0) + (event.usage?.completion ?? 0);

    if (delta > 0) {
      spent += delta;
    }

    if (rules.warnAt && spent >= rules.warnAt) {
      await hooks?.onWarn?.(spent, rules.limit);
    }

    if (rules.limit > 0 && spent >= rules.limit) {
      await agent.stop();
      await hooks?.onCutoff?.(spent, rules.limit);
      return { outcome: "cutoff", spent };
    }

    if (event.kind === "session.idle") {
      break;
    }
  }

  return { outcome: "completed", spent };
}

export async function runTurnWithBudget(
  agent: AgentHandle,
  prompt: string,
  policy: BudgetPolicy,
  hooks?: {
    onEvent?: (
      event: EventLike,
      spent: number,
      limit: number,
    ) => void | Promise<void>;
    onWarning?: (spent: number, limit: number) => void | Promise<void>;
    onInterrupt?: (spent: number, limit: number) => void | Promise<void>;
  },
): Promise<{ status: "completed" | "budget_exceeded"; spent: number }> {
  let spent = 0;

  await agent.openTask(prompt);

  for await (const event of agent.stream()) {
    const delta = extractTokenDelta(event);

    if (delta > 0) {
      spent += delta;
    }

    await hooks?.onEvent?.(event, spent, policy.maxTokens);

    if (policy.warningThreshold && spent >= policy.warningThreshold) {
      await hooks?.onWarning?.(spent, policy.maxTokens);
    }

    if (policy.maxTokens > 0 && spent >= policy.maxTokens) {
      await agent.interrupt();
      await hooks?.onInterrupt?.(spent, policy.maxTokens);
      return { status: "budget_exceeded", spent };
    }

    if (event.type === "session.status_idle") {
      break;
    }
  }

  return { status: "completed", spent };
}
