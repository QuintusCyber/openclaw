import { describeToolForVerbose } from "../agents/tool-description-summary.js";
import { normalizeToolName } from "../agents/tool-policy-shared.js";
import type { EffectiveToolInventoryResult } from "../agents/tools-effective-inventory.types.js";
export {
  buildCommandsMessage,
  buildCommandsMessagePaginated,
  buildHelpMessage,
  type CommandsMessageOptions,
  type CommandsMessageResult,
} from "./command-status-builders.js";
export {
  buildStatusMessage,
  formatContextUsageShort,
  formatTokenCount,
  type StatusArgs,
} from "../status/status-message.js";

type ToolsInventoryGroup = EffectiveToolInventoryResult["groups"][number];
type ToolsInventoryEntry = ToolsInventoryGroup["tools"][number];
type ToolsInventorySource = ToolsInventoryGroup["source"];

type ToolsMessageItem = {
  id: string;
  name: string;
  description: string;
  rawDescription: string;
  source: ToolsInventorySource;
  pluginId?: string;
  channelId?: string;
};

type InventoryStringReadResult = { ok: true; value: string } | { ok: false };

function readInventoryString(read: () => unknown): InventoryStringReadResult {
  try {
    const value = read();
    return typeof value === "string" ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function readOptionalInventoryString(read: () => unknown): string | undefined {
  const result = readInventoryString(read);
  return result.ok ? result.value : undefined;
}

function isToolsInventorySource(value: unknown): value is ToolsInventorySource {
  return value === "core" || value === "plugin" || value === "channel" || value === "mcp";
}

function readToolsInventorySource(tool: ToolsInventoryEntry): ToolsInventorySource {
  try {
    const source = tool.source;
    return isToolsInventorySource(source) ? source : "core";
  } catch {
    return "core";
  }
}

function readToolsInventoryEntries(group: ToolsInventoryGroup): ToolsInventoryEntry[] | null {
  try {
    return Array.isArray(group.tools) ? group.tools : null;
  } catch {
    return null;
  }
}

function readToolsMessageItem(tool: ToolsInventoryEntry): ToolsMessageItem | null {
  const rawId = readInventoryString(() => tool.id);
  if (!rawId.ok) {
    return null;
  }
  const id = normalizeToolName(rawId.value);
  if (!id) {
    return null;
  }

  const label = readInventoryString(() => tool.label);
  const description = readInventoryString(() => tool.description);
  const rawDescription = readInventoryString(() => tool.rawDescription);
  if (!label.ok || !description.ok || !rawDescription.ok) {
    return null;
  }

  const safeDescription = description.value || "Tool";
  return {
    id,
    name: label.value || id,
    description: safeDescription,
    rawDescription: rawDescription.value || safeDescription,
    source: readToolsInventorySource(tool),
    pluginId: readOptionalInventoryString(() => tool.pluginId),
    channelId: readOptionalInventoryString(() => tool.channelId),
  };
}

function sortToolsMessageItems(items: ToolsMessageItem[]): ToolsMessageItem[] {
  return items.toSorted((a, b) => a.name.localeCompare(b.name));
}

function formatCompactToolEntry(tool: ToolsMessageItem): string {
  if (tool.source === "plugin") {
    return tool.pluginId ? `${tool.id} (${tool.pluginId})` : tool.id;
  }
  if (tool.source === "channel") {
    return tool.channelId ? `${tool.id} (${tool.channelId})` : tool.id;
  }
  return tool.id;
}

function formatVerboseToolDescription(tool: ToolsMessageItem): string {
  return describeToolForVerbose({
    rawDescription: tool.rawDescription,
    fallback: tool.description,
  });
}

export function buildToolsMessage(
  result: EffectiveToolInventoryResult,
  options?: { verbose?: boolean },
): string {
  const groups: Array<{ label: string; tools: ToolsMessageItem[] }> = [];
  for (const group of result.groups) {
    const groupTools = readToolsInventoryEntries(group);
    if (!groupTools) {
      continue;
    }
    const tools: ToolsMessageItem[] = [];
    for (const tool of groupTools) {
      const item = readToolsMessageItem(tool);
      if (item) {
        tools.push(item);
      }
    }
    if (tools.length > 0) {
      groups.push({
        label: readOptionalInventoryString(() => group.label) || "Tools",
        tools: sortToolsMessageItems(tools),
      });
    }
  }

  if (groups.length === 0) {
    const lines = [
      "No tools are available for this agent right now.",
      "",
      `Profile: ${result.profile}`,
    ];
    return lines.join("\n");
  }

  const verbose = options?.verbose === true;
  const lines = verbose
    ? ["Available tools", "", `Profile: ${result.profile}`, "What this agent can use right now:"]
    : ["Available tools", "", `Profile: ${result.profile}`];

  for (const group of groups) {
    lines.push("", group.label);
    if (verbose) {
      for (const tool of group.tools) {
        lines.push(`  ${tool.name} - ${formatVerboseToolDescription(tool)}`);
      }
      continue;
    }
    const compactTools: string[] = [];
    for (const tool of group.tools) {
      compactTools.push(formatCompactToolEntry(tool));
    }
    lines.push(`  ${compactTools.join(", ")}`);
  }

  if (verbose) {
    lines.push("", "Tool availability depends on this agent's configuration.");
  } else {
    lines.push("", "Use /tools verbose for descriptions.");
  }
  if (result.notices?.length) {
    lines.push("", "Notes");
    for (const notice of result.notices) {
      lines.push(`  ${notice.message}`);
    }
  }
  return lines.join("\n");
}
