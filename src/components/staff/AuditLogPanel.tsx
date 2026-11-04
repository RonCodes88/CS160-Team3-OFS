"use client";

import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AUDIT_ACTIONS } from "@/lib/audit/log";
import { ACTION_LABELS, describeChanges, formatAuditTime } from "./auditFormat";
import { Notice, type NoticeValue } from "./Notice";
import { fetchAuditLog, PAGE_SIZE, type AuditAction, type AuditEntry, type AuditPage } from "./staffApi";
import { inputClass, smallButton } from "./styles";

/** Manager view of every inventory and product change, newest first. */
export function AuditLogPanel({ categoryNames }: { categoryNames: Record<string, string> }) {
  const [action, setAction] = useState<AuditAction | null>(null);
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeValue>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAuditLog(action, offset).then((result) => {
      if (cancelled) return;
      if (result.ok) setPage(result.data);
      else setNotice({ kind: "error", text: result.message });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [action, offset, reloadKey]);

  function reload(changes: () => void) {
    setLoading(true);
    changes();
  }

  const entries = page?.entries ?? [];

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-lg">
          Show
          <select
            value={action ?? ""}
            onChange={(event) =>
              reload(() => {
                setAction((event.target.value || null) as AuditAction | null);
                setOffset(0);
              })
            }
            className={inputClass}
          >
            <option value="">All changes</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={smallButton} onClick={() => reload(() => setReloadKey((k) => k + 1))}>
          Refresh
        </button>
      </div>

      <Notice notice={notice} onDismiss={() => setNotice(null)} />

      {loading && !page ? (
        <p className="mt-8 animate-pulse text-center font-heading text-2xl">Loading audit log...</p>
      ) : !page ? (
        <Card className="mt-6 text-center">
          <p className="text-2xl">The audit log couldn&apos;t be loaded.</p>
          <Button className="mt-4" onClick={() => reload(() => setReloadKey((k) => k + 1))}>
            Try again
          </Button>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="mt-6 text-center">
          <ScrollText aria-hidden strokeWidth={2.5} className="mx-auto h-12 w-12" />
          <p className="mt-4 text-2xl">No changes recorded yet.</p>
        </Card>
      ) : (
        <ol className={`mt-6 space-y-3 transition-opacity ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          {entries.map((entry) => (
            <AuditEntryRow key={entry.id} entry={entry} categoryNames={categoryNames} />
          ))}
        </ol>
      )}

      {(offset > 0 || page?.hasMore) && (
        <div className="mt-6 flex justify-between">
          <button
            type="button"
            className={smallButton}
            disabled={offset === 0 || loading}
            onClick={() => reload(() => setOffset((o) => Math.max(0, o - PAGE_SIZE)))}
          >
            Newer
          </button>
          <button
            type="button"
            className={smallButton}
            disabled={!page?.hasMore || loading}
            onClick={() => reload(() => setOffset((o) => o + PAGE_SIZE))}
          >
            Older
          </button>
        </div>
      )}
    </div>
  );
}

export function AuditEntryRow({ entry, categoryNames }: { entry: AuditEntry; categoryNames: Record<string, string> }) {
  const changes = describeChanges(entry, categoryNames);
  return (
    <li className="rounded-wobbly-md border-2 border-pencil bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-xl">
          {ACTION_LABELS[entry.action]}: {entry.productName ?? "Unknown product"}
          {entry.productSku && <span className="ml-2 text-base text-pencil/70">{entry.productSku}</span>}
        </p>
        <time dateTime={entry.createdAt} className="text-base text-pencil/70">
          {formatAuditTime(entry.createdAt)}
        </time>
      </div>
      {changes.length > 0 && (
        <ul className="mt-2 text-lg">
          {changes.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-base text-pencil/70">by {entry.actorEmail ?? "unknown user"}</p>
    </li>
  );
}
