import { Button } from "@/components/ui/button";

/** Reusable destructive/confirm dialog. Matches the existing card aesthetic. */
export function ConfirmModal(props: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 px-5 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-[22px] border border-border bg-card p-7"
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <h2 className="text-2xl">{props.title}</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{props.body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            variant="ghost"
            className="rounded-[32px]"
            disabled={props.pending}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button
            variant={props.tone === "danger" ? "destructive" : "default"}
            className="rounded-[32px]"
            disabled={props.pending}
            onClick={props.onConfirm}
          >
            {props.pending ? "Please wait…" : (props.confirmLabel ?? "Confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
