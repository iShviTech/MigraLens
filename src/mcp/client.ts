import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCommand } from "../utils/command.js";
import { logWarn } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

export interface McpCallOptions {
  timeoutMs: number;
  attempts: number;
  baseDelayMs: number;
}

export class McpStdioClient {
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private connecting: Promise<void> | undefined;

  constructor(
    private readonly commandLine: string,
    private readonly extraEnv: Record<string, string | undefined> = {}
  ) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }
    if (!this.connecting) {
      this.connecting = this.open();
    }
    await this.connecting;
  }

  private async open(): Promise<void> {
    const { command, args } = parseCommand(this.commandLine);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        env[key] = value;
      }
    }
    for (const [key, value] of Object.entries(this.extraEnv)) {
      if (typeof value === "string" && value.length > 0) {
        env[key] = value;
      }
    }

    this.transport = new StdioClientTransport({
      command,
      args,
      env,
      stderr: "inherit"
    });

    this.client = new Client({ name: "migralens", version: "1.0.0" });
    await this.client.connect(this.transport);
  }

  async listToolNames(): Promise<string[]> {
    await this.connect();
    const listed = await this.client!.listTools();
    return listed.tools.map((tool) => tool.name);
  }

  async callTool(name: string, args: Record<string, unknown>, options: McpCallOptions): Promise<unknown> {
    await this.connect();
    return withRetry(
      async () => {
        const result = await this.client!.callTool({ name, arguments: args }, undefined, {
          timeout: options.timeoutMs
        });
        if ("isError" in result && result.isError) {
          throw new Error(`MCP tool ${name} returned an error: ${stringifyMcpContent(result.content)}`);
        }
        return parseMcpResult(result);
      },
      {
        attempts: options.attempts,
        baseDelayMs: options.baseDelayMs,
        label: `mcp:${name}`,
        onRetry: (error, attempt) => {
          logWarn(`Retrying MCP tool ${name}`, {
            attempt,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    );
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client) {
      await client.close().catch(() => undefined);
    }
    this.transport = undefined;
  }
}

export class McpClientPool {
  private readonly available: McpStdioClient[] = [];
  private readonly all: McpStdioClient[] = [];
  private readonly waiters: Array<(client: McpStdioClient) => void> = [];
  private created = 0;

  constructor(
    private readonly size: number,
    private readonly factory: () => McpStdioClient
  ) {}

  async withClient<T>(fn: (client: McpStdioClient) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    try {
      return await fn(client);
    } finally {
      this.release(client);
    }
  }

  private async acquire(): Promise<McpStdioClient> {
    const idle = this.available.pop();
    if (idle) {
      return idle;
    }
    if (this.created < this.size) {
      this.created += 1;
      const created = this.factory();
      this.all.push(created);
      await created.connect();
      return created;
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(client: McpStdioClient): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(client);
      return;
    }
    this.available.push(client);
  }

  async close(): Promise<void> {
    this.waiters.length = 0;
    this.available.length = 0;
    await Promise.all(this.all.map((client) => client.close()));
    this.all.length = 0;
    this.created = 0;
  }
}

function stringifyMcpContent(content: unknown): string {
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function parseMcpResult(result: unknown): unknown {
  if (!result || typeof result !== "object") {
    return result;
  }
  const record = result as { content?: unknown; structuredContent?: unknown };
  if (record.structuredContent !== undefined) {
    return record.structuredContent;
  }
  if (!Array.isArray(record.content)) {
    return result;
  }

  const texts = record.content
    .filter((item): item is { type: string; text: string } => {
      return Boolean(item && typeof item === "object" && "text" in item && typeof (item as { text: unknown }).text === "string");
    })
    .map((item) => item.text);

  if (texts.length === 0) {
    return result;
  }

  const joined = texts.join("\n");
  const jsonCandidate = extractJson(joined);
  if (jsonCandidate !== undefined) {
    return jsonCandidate;
  }
  return joined;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
