import type { ControlCommand } from "@opencode/chrome-relay-protocol";
import {
  RelayBrokerClient,
  SessionContextManager,
  browserTools,
  type RelayClientOptions,
} from "opencode-chrome-relay";

export interface GatewayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RelayClientLike {
  connect(): Promise<void>;
  disconnect(): void;
  sendAction(action: any, tabId?: number): Promise<any>;
  sendControl(command: ControlCommand["command"], instruction?: string): Promise<any>;
  getRunId(): string;
  getEpoch(): number;
}

export interface PipelineStep {
  tool: string;
  arguments?: Record<string, unknown>;
}

export interface PipelineRequest {
  steps: PipelineStep[];
  continue_on_error?: boolean;
}

const controlTools: Record<string, ControlCommand["command"]> = {
  relay_pause: "pause",
  relay_resume: "resume",
  relay_stop: "stop",
  relay_restart: "restart",
  relay_take_over: "take_over",
  relay_return_control: "return_control",
};

const emptySchema = { type: "object", properties: {}, additionalProperties: false };

export function getGatewayTools(): GatewayTool[] {
  const browserManifest = Object.values(browserTools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
  const controls = Object.keys(controlTools).map((name) => ({
    name,
    description: `${name.replaceAll("_", " ")} for the active relay run.`,
    inputSchema: emptySchema,
  }));
  return [
    ...browserManifest,
    ...controls,
    {
      name: "relay_status",
      description: "Report gateway connectivity, run identity, epoch, and available capabilities.",
      inputSchema: emptySchema,
    },
    {
      name: "browser_run_pipeline",
      description: "Run an ordered browser-tool pipeline with correlated results and fail-fast behavior.",
      inputSchema: {
        type: "object",
        required: ["steps"],
        additionalProperties: false,
        properties: {
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 25,
            items: {
              type: "object",
              required: ["tool"],
              additionalProperties: false,
              properties: {
                tool: { type: "string" },
                arguments: { type: "object", additionalProperties: true },
              },
            },
          },
          continue_on_error: { type: "boolean", default: false },
        },
      },
    },
  ];
}

export class AgentGateway {
  private readonly client: RelayClientLike;
  private readonly sessionManager = new SessionContextManager();
  private connected = false;
  private connectionAttempt: Promise<void> | null = null;

  constructor(options: RelayClientOptions = {}, client?: RelayClientLike) {
    this.client = client || new RelayBrokerClient(options);
  }

  public listTools(): GatewayTool[] {
    return getGatewayTools();
  }

  public async execute(name: string, args: Record<string, any> = {}): Promise<any> {
    if (name === "relay_status") {
      try {
        await this.ensureConnected();
      } catch (error) {
        return {
          connected: false,
          run_id: this.client.getRunId(),
          epoch: this.client.getEpoch(),
          error: error instanceof Error ? error.message : String(error),
          tool_count: this.listTools().length,
        };
      }
      return {
        connected: true,
        run_id: this.client.getRunId(),
        epoch: this.client.getEpoch(),
        tool_count: this.listTools().length,
      };
    }

    if (name === "browser_run_pipeline") {
      return this.runPipeline(args as PipelineRequest);
    }

    const control = controlTools[name];
    if (control) {
      await this.ensureConnected();
      return this.client.sendControl(control, args.instruction);
    }

    const tool = browserTools[name];
    if (!tool) {
      throw new Error(`Unknown relay tool: ${name}`);
    }

    this.validateRequiredArguments(name, tool.parameters, args);
    await this.ensureConnected();
    return tool.execute(args, this.client as RelayBrokerClient, this.sessionManager);
  }

  public disconnect(): void {
    this.client.disconnect();
    this.connected = false;
    this.connectionAttempt = null;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (!this.connectionAttempt) {
      this.connectionAttempt = this.client
        .connect()
        .then(() => {
          this.connected = true;
        })
        .finally(() => {
          this.connectionAttempt = null;
        });
    }
    await this.connectionAttempt;
  }

  private async runPipeline(request: PipelineRequest): Promise<any> {
    if (!Array.isArray(request.steps) || request.steps.length === 0) {
      throw new Error("Pipeline requires at least one step");
    }
    if (request.steps.length > 25) {
      throw new Error("Pipeline cannot exceed 25 steps");
    }

    const results: Array<Record<string, unknown>> = [];
    for (let index = 0; index < request.steps.length; index += 1) {
      const step = request.steps[index];
      if (!step || typeof step.tool !== "string" || step.tool === "browser_run_pipeline") {
        throw new Error(`Invalid pipeline step at index ${index}`);
      }
      try {
        const result = await this.execute(step.tool, step.arguments || {});
        results.push({ index, tool: step.tool, success: true, result });
      } catch (error) {
        results.push({
          index,
          tool: step.tool,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!request.continue_on_error) break;
      }
    }

    return {
      success: results.every((result) => result.success === true),
      completed_steps: results.length,
      requested_steps: request.steps.length,
      results,
    };
  }

  private validateRequiredArguments(
    toolName: string,
    schema: Record<string, any>,
    args: Record<string, any>
  ): void {
    for (const required of schema.required || []) {
      if (args[required] === undefined || args[required] === null) {
        throw new Error(`${toolName} requires argument: ${required}`);
      }
    }
  }
}
