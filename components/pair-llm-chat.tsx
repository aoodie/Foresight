"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Message = { role: "user" | "assistant"; content: string; at: string };
type Threads = Record<string, Message[]>;

const storageKey = "foresight:pair-chat:v1";
const prompts = ["Explain this regime", "Where should I wait for entry?", "What invalidates the setup?"];

function loadThreads() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([instrument, values]) => [instrument, Array.isArray(values) ? values.filter((value): value is Message => Boolean(value && typeof value === "object" && ((value as Message).role === "user" || (value as Message).role === "assistant") && typeof (value as Message).content === "string")).slice(-30) : []]));
  } catch {
    return {};
  }
}

export function PairLlmChat({ instrument, connected, snapshot }: { instrument: string; connected: boolean; snapshot: Record<string, unknown> }) {
  const [threads, setThreads] = useState<Threads>({});
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(() => threads[instrument] ?? [], [instrument, threads]);

  useEffect(() => { const timer = window.setTimeout(() => { setThreads(loadThreads()); setHydrated(true); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (hydrated) { try { window.localStorage.setItem(storageKey, JSON.stringify(threads)); } catch { /* Chat remains usable if browser storage is unavailable. */ } } }, [hydrated, threads]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [busy, messages.length]);

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || busy || !connected) return;
    const targetInstrument = instrument;
    const history = threads[targetInstrument] ?? [];
    const userMessage: Message = { role: "user", content: text, at: new Date().toISOString() };
    setThreads((previous) => ({ ...previous, [targetInstrument]: [...(previous[targetInstrument] ?? []), userMessage].slice(-30) }));
    setDraft(""); setError(""); setBusy(true);
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instrument: targetInstrument, question: text, messages: history.map(({ role, content }) => ({ role, content })), snapshot }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Pair assistant could not answer.");
      const assistantMessage: Message = { role: "assistant", content: String(payload.answer), at: payload.generatedAt ?? new Date().toISOString() };
      setThreads((previous) => ({ ...previous, [targetInstrument]: [...(previous[targetInstrument] ?? []), assistantMessage].slice(-30) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Pair assistant could not answer.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void send(draft); };
  const clear = () => setThreads((previous) => ({ ...previous, [instrument]: [] }));

  return (
    <aside className="flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-white/8 bg-black/15">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div className="flex gap-2.5"><Bot size={18} className="mt-0.5 text-[#89f6bf]" /><div><p className="text-xs font-semibold tracking-[.1em] text-white">PAIR ANALYST</p><p className="mt-1 text-[10px] text-[#81978f]">{instrument.replace("_", " / ")} context only · separate saved thread</p></div></div>
        <button type="button" onClick={clear} disabled={!messages.length} aria-label={`Clear ${instrument} chat`} className="rounded-md p-1.5 text-[#71887f] hover:bg-white/5 hover:text-white disabled:opacity-30"><Trash2 size={15} /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!messages.length && <div className="rounded-lg border border-dashed border-white/10 p-4 text-xs leading-5 text-[#8fa59b]">Ask why the pair has its current regime, what confirmation is missing, where support/resistance matters, or what would invalidate the plan.</div>}
        {messages.map((message, index) => <div key={`${message.at}-${index}`} className={(message.role === "user" ? "ml-8 bg-[#a4ffcf]/10 text-[#d9fbe8]" : "mr-4 bg-white/[.045] text-[#c7d2cc]") + " rounded-xl px-3 py-2.5 text-xs leading-5 whitespace-pre-wrap"}><p className="mb-1 text-[9px] font-semibold uppercase tracking-[.1em] text-[#81978f]">{message.role === "user" ? "You" : "LLM analyst"}</p>{message.content}</div>)}
        {busy && <div className="mr-4 rounded-xl bg-white/[.045] px-3 py-3 text-xs text-[#8fa59b]">Analysing {instrument.replace("_", " / ")}…</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => void send(prompt)} disabled={busy || !connected} className="rounded-full border border-white/8 px-2 py-1 text-[9px] text-[#8fa59b] hover:border-[#a4ffcf]/25 hover:text-[#89f6bf] disabled:opacity-40">{prompt}</button>)}</div>
        {error && <p className="mb-2 text-[10px] leading-4 text-rose-200">{error}</p>}
        {!connected && <p className="mb-2 text-[10px] leading-4 text-amber-100/75">Connect the LLM provider in Settings to chat.</p>}
        <form onSubmit={submit} className="flex items-end gap-2">
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(draft); } }} maxLength={2000} rows={2} placeholder={`Ask about ${instrument.replace("_", " / ")}…`} className="min-h-16 resize-none border-white/10 bg-[#10221d] text-xs text-white placeholder:text-[#60736c]" />
          <Button type="submit" size="icon" disabled={!connected || busy || !draft.trim()} aria-label="Send pair question" className="bg-[#a4ffcf] text-[#07100f] hover:bg-[#d0ffe1]"><Send size={16} /></Button>
        </form>
        <p className="mt-2 text-[9px] leading-4 text-[#60736c]">Research only. The chat cannot place, change or close orders.</p>
      </div>
    </aside>
  );
}
