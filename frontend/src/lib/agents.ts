// 多 agent 能力的前端客户端：反思审计。
// 走后端 NDJSON 流；模型配置沿用「接入 AI」里存的那一份（用户自己的 key / 本机 CLI）。

import { ApiError } from "@/lib/api";
import { loadLlm } from "@/lib/llm";
import { streamNdjson } from "@/lib/ndjson";

function requireLlm() {
  const llm = loadLlm();
  if (!llm) throw new ApiError("尚未接入 AI，请先在「接入 AI」里配置", 400);
  return llm;
}

export interface ReflectHandlers {
  onStatus?: (message: string) => void;
  onDelta?: (text: string) => void;
  onDone?: (content: string, truncated: boolean) => void;
  onError?: (message: string) => void;
}

/** 对一段已写好的分析做推理审计。 */
export async function reflectStream(
  source: string,
  title: string,
  handlers: ReflectHandlers = {},
  signal?: AbortSignal,
): Promise<void> {
  const llm = requireLlm();
  await streamNdjson("/api/reflect", { source, title, llm }, (ev) => {
    if (ev.type === "status") handlers.onStatus?.(ev.message);
    else if (ev.type === "delta") handlers.onDelta?.(ev.text);
    else if (ev.type === "done") handlers.onDone?.(ev.content, !!ev.truncated);
    else if (ev.type === "error") handlers.onError?.(ev.message);
  }, signal);
}
