import { useState } from "react";
import type { Arrow, ArrowType } from "./phase2-contract";
import { message } from "./api";
export default function ArrowEditor({
  arrow,
  onSave,
  onDelete,
  onClose,
}: {
  arrow: Arrow;
  onSave: (patch: Partial<Arrow>) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [type, setType] = useState(arrow.type),
    [label, setLabel] = useState(arrow.label || ""),
    [color, setColor] = useState(arrow.color || "#a9543c"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="arrow-editor"
      aria-label="Edit arrow"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave({ type, label: label || null, color });
        } catch (e) {
          setError(message(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="reader-toolbar">
        <strong>Relationship</strong>
        <button type="button" aria-label="Close arrow editor" onClick={onClose}>
          ×
        </button>
      </div>
      <label>
        Type
        <select
          aria-label="Arrow type"
          value={type}
          onChange={(e) => setType(e.target.value as ArrowType)}
        >
          <option value="parent_child">Parent → child</option>
          <option value="related">Related</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <label>
        Label
        <input
          aria-label="Arrow label"
          value={label}
          maxLength={240}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="arrow-color">
        Colour
        <input
          aria-label="Arrow colour"
          type="color"
          value={/^#[\da-f]{6}$/i.test(color) ? color : "#a9543c"}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <p className="muted">Drag an endpoint to re-route this arrow.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onDelete}>
          Delete arrow
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save arrow"}
        </button>
      </div>
    </form>
  );
}
