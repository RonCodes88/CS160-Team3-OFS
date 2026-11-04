import { AlertTriangle, CheckCircle2 } from "lucide-react";

export type NoticeValue = { kind: "error" | "success"; text: string } | null;

/**
 * Result of the last action. The live region is always rendered so screen
 * readers announce the message when it appears.
 */
export function Notice({ notice, onDismiss }: { notice: NoticeValue; onDismiss: () => void }) {
  const isError = notice?.kind === "error";
  const Icon = isError ? AlertTriangle : CheckCircle2;
  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        notice
          ? `mt-6 flex items-start gap-3 rounded-wobbly-md border-[3px] bg-white p-4 text-lg shadow-hard-sm ${isError ? "border-marker" : "border-pen"}`
          : "sr-only"
      }
    >
      {notice && (
        <>
          <Icon
            aria-hidden
            strokeWidth={2.5}
            className={`mt-1 h-6 w-6 shrink-0 ${isError ? "text-marker" : "text-pen"}`}
          />
          <p className="flex-1">{notice.text}</p>
          <button type="button" onClick={onDismiss} className="underline decoration-marker">
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
