"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type JournalEntry = Record<string, string | number | null> & { id: string; created_at: string; instrument: string; direction: string; style: string; status: string };

const inputClass = "h-10 rounded-md border border-white/10 bg-[#10221d] px-3 text-sm text-white outline-none focus:border-[#a4ffcf]";

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ instrument: "EUR_USD", direction: "long", style: "intraday", strategyName: "", entryPrice: "", stopLoss: "", takeProfit1: "", takeProfit2: "", riskPercent: "0.5", units: "", notes: "" });
  const [result, setResult] = useState({ status: "closed", pnl: "", notes: "" });

  const load = useCallback(async () => {
    const response = await fetch("/api/journal?limit=200", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load journal.");
    setEntries(Array.isArray(payload.entries) ? payload.entries : []);
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Unable to load journal.")), 0); return () => window.clearTimeout(timer); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, entryPrice: Number(form.entryPrice) || null, stopLoss: Number(form.stopLoss) || null, takeProfit1: Number(form.takeProfit1) || null, takeProfit2: Number(form.takeProfit2) || null, riskPercent: Number(form.riskPercent) || null, units: Number(form.units) || null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to save journal entry.");
      setMessage("Journal entry saved.");
      setForm({ instrument: "EUR_USD", direction: "long", style: "intraday", strategyName: "", entryPrice: "", stopLoss: "", takeProfit1: "", takeProfit2: "", riskPercent: "0.5", units: "", notes: "" });
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save journal entry."); } finally { setSaving(false); }
  };

  const update = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/journal", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selectedId, status: result.status, pnl: Number(result.pnl) || null, notes: result.notes, closedAt: result.status === "open" ? null : new Date().toISOString() }) });
    const payload = await response.json();
    setMessage(response.ok ? "Journal result updated." : payload.error || "Unable to update journal.");
    if (response.ok) await load();
  };

}
