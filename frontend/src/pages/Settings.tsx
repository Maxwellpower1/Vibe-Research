import { useState } from "react";
import { KeyRound, Sparkles, ShieldCheck, Check, Trash2, Terminal } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { toast } from "sonner";
import { loadLlm, saveLlm, clearLlm } from "@/lib/llm";
import { loadAccessKey, saveAccessKey } from "@/lib/api";
import { subscriptionModels, apiModels, PROVIDER_BASE, isCliProvider, aiModels, type ProviderId } from "@/lib/ai-models";
import { cn } from "@/lib/utils";

export function Settings() {
  const existing = loadLlm();
  const existingIsCli = existing ? isCliProvider(existing.provider) : false;

  const [mode, setMode] = useState<"api" | "subscription">(existing && existingIsCli ? "subscription" : "api");
  const [cliId, setCliId] = useState(existing && existingIsCli ? existing.model : "");
  const firstApi = apiModels[0];
  const [apiId, setApiId] = useState(existing && !existingIsCli ? existing.model : firstApi.id);
  const [baseURL, setBaseURL] = useState(existing && !existingIsCli ? existing.baseURL : (PROVIDER_BASE[firstApi.provider] || ""));
  const [modelName, setModelName] = useState(existing && !existingIsCli ? existing.model : firstApi.id);
  const [apiKey, setApiKey] = useState(existing && !existingIsCli ? existing.apiKey : "");
  const [accessKey, setAccessKey] = useState(loadAccessKey());
  const [apiErrors, setApiErrors] = useState<Record<string, string>>({});
  const [cliError, setCliError] = useState("");

  const providerOf = (id: string): ProviderId => aiModels.find((m) => m.id === id)?.provider ?? "openai-compatible";

  const pickApiModel = (id: string) => {
    const m = apiModels.find((x) => x.id === id);
    if (!m) return;
    setApiId(id);
    setModelName(id);
    setBaseURL(PROVIDER_BASE[m.provider] || "");
    setApiErrors({});
  };

  const saveApi = () => {
    const next: Record<string, string> = {};
    if (!baseURL.trim()) next.baseURL = "请填写 Base URL";
    if (!modelName.trim()) next.modelName = "请填写 Model";
    if (!apiKey.trim()) next.apiKey = "请填写 API Key";
    setApiErrors(next);
    if (Object.keys(next).length) {
      toast.error("请补全标红的字段");
      return;
    }
    saveLlm({ provider: providerOf(apiId), baseURL: baseURL.trim(), apiKey: apiKey.trim(), model: modelName.trim() });
    toast.success("已保存到本地，全站「问 AI / 复盘」现在可用");
  };

  const saveSubscription = () => {
    const m = subscriptionModels.find((x) => x.id === cliId);
    if (!m || m.comingSoon) {
      setCliError("请选择一个可用的订阅（暂不支持标「即将支持」的）");
      toast.error("请选择一个可用的订阅");
      return;
    }
    setCliError("");
    saveLlm({ provider: m.provider, baseURL: "", apiKey: "", model: m.id });
    toast.success(`已选「${m.name}」订阅，全站「问 AI / 复盘」将调用本机 ${m.name}`);
  };

  const forget = () => {
    clearLlm();
    setApiKey("");
    setCliId("");
    setApiErrors({});
    setCliError("");
    toast.success("已清除本地配置");
  };

  const saveAccess = () => {
    const k = accessKey.trim();
    saveAccessKey(k);
    setAccessKey(k);
    toast.success(k ? "已保存后端访问密钥（存本地）" : "已清除后端访问密钥");
  };

  return (
    <div>
      <PageHeader title="接入 AI" subtitle="配置一次，全站的「问 AI」「复盘」都能用你自己的模型" />

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>API key <b className="text-foreground">只存在你本地浏览器</b>，仅在你提问时发给你自己的后端去调模型，不上传、不进仓库。所有分析由你的模型给出，本产品不校准。</span>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <GlassCard
          glow={mode === "subscription"}
          onClick={() => setMode("subscription")}
          className={mode === "subscription" ? "ring-1 ring-primary/40" : "opacity-80"}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">订阅接入</h3>
            {mode === "subscription" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            调本机已登录的 AI CLI（Claude Code / Qwen / DeepSeek / Codex…），用订阅额度，
            <b className="text-foreground">免 API key</b>。需后端在本机跑。
          </p>
        </GlassCard>

        <GlassCard
          glow={mode === "api"}
          onClick={() => setMode("api")}
          className={mode === "api" ? "ring-1 ring-primary/40" : "opacity-80"}
        >
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">API 接入</h3>
            {mode === "api" && <Check className="ml-auto h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            粘贴 API key，支持 DeepSeek / 豆包 / MiniMax / OpenAI / OpenRouter / 任意兼容端点。
            <b className="text-foreground">现已可用。</b>
          </p>
        </GlassCard>
      </div>

      <GlassCard>
        {mode === "subscription" ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              选一个你本机已安装并登录的 CLI。Vibe-Research 后端会用它以你的订阅额度作答，
              <b className="text-foreground">不用填 key</b>。
              <span className="text-muted-foreground/60">（仅当后端跑在你本机时可用。）</span>
            </p>
            <div className="grid gap-2 sm:grid-cols-2" role="listbox" aria-label="订阅 CLI">
              {subscriptionModels.map((m) => {
                const on = cliId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={m.comingSoon}
                    onClick={() => {
                      setCliId(m.id);
                      setCliError("");
                    }}
                    className={cn(
                      "btn-press flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left",
                      m.comingSoon
                        ? "cursor-not-allowed border-border/50 opacity-40"
                        : on
                          ? "border-primary/50 bg-primary/10 ring-1 ring-primary/25"
                          : "border-border hover:bg-muted/40",
                    )}
                  >
                    <Terminal className={cn("h-4 w-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        {m.name}
                        {m.comingSoon && (
                          <span className="rounded bg-muted/60 px-1 py-0.5 text-[9px] text-muted-foreground">即将支持</span>
                        )}
                        {on && <Check className="h-3.5 w-3.5 text-primary" />}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{m.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {cliError && <p className="field-error" role="alert">{cliError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={saveSubscription}
                className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/25"
              >
                保存
              </button>
              {existing && (
                <button
                  type="button"
                  onClick={forget}
                  className="btn-press inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> 清除
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="field">
              <label className="field-label" htmlFor="settings-api-model">选择模型</label>
              <select
                id="settings-api-model"
                value={apiId}
                onChange={(e) => pickApiModel(e.target.value)}
                className="field-input"
              >
                {apiModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} - {m.description}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="settings-base-url">Base URL</label>
              <input
                id="settings-base-url"
                value={baseURL}
                onChange={(e) => {
                  setBaseURL(e.target.value);
                  if (apiErrors.baseURL) setApiErrors((s) => ({ ...s, baseURL: "" }));
                }}
                placeholder="https://api.deepseek.com"
                aria-invalid={!!apiErrors.baseURL}
                className="field-input"
              />
              {apiErrors.baseURL
                ? <p className="field-error" role="alert">{apiErrors.baseURL}</p>
                : <p className="field-hint">智谱等端点可用 /v4 结尾，不必再被补成 /v4/v1。</p>}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="settings-model-name">Model</label>
              <input
                id="settings-model-name"
                value={modelName}
                onChange={(e) => {
                  setModelName(e.target.value);
                  if (apiErrors.modelName) setApiErrors((s) => ({ ...s, modelName: "" }));
                }}
                placeholder="模型名称（豆包填 ep-… 接入点 ID）"
                aria-invalid={!!apiErrors.modelName}
                className="field-input"
              />
              {apiErrors.modelName && <p className="field-error" role="alert">{apiErrors.modelName}</p>}
            </div>

            <div className="field">
              <label className="field-label" htmlFor="settings-api-key">API Key</label>
              <input
                id="settings-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (apiErrors.apiKey) setApiErrors((s) => ({ ...s, apiKey: "" }));
                }}
                placeholder="sk-…"
                aria-invalid={!!apiErrors.apiKey}
                className="field-input"
                autoComplete="off"
              />
              {apiErrors.apiKey
                ? <p className="field-error" role="alert">{apiErrors.apiKey}</p>
                : <p className="field-hint">只存本机浏览器，提问时才发给你的后端。</p>}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveApi}
                className="btn-press inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/25"
              >
                保存（存本地）
              </button>
              {existing && (
                <button
                  type="button"
                  onClick={forget}
                  className="btn-press inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> 清除
                </button>
              )}
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="mt-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-primary" /> 后端访问密钥（可选）
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          仅当后端部署时设置了 <code className="rounded bg-muted/50 px-1">VR_API_KEY</code>（公网部署防蹭用）才需要填，填后端同一个值；
          本机自用没设鉴权就留空。同样只存本地浏览器。
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            placeholder="与后端 VR_API_KEY 保持一致"
            className="field-input flex-1"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={saveAccess}
            className="btn-press shrink-0 rounded-lg bg-primary/15 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/20 hover:bg-primary/25"
          >
            保存
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
