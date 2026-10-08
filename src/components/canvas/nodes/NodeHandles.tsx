"use client";

import { Handle, Position } from "@xyflow/react";
import { memo } from "react";

/**
 * Four side handles (ids "top", "right", "bottom", "left") that double as
 * JSON Canvas `fromSide` / `toSide`. All are source handles; the flow runs in
 * loose connection mode so any handle can also be a target.
 */
export const NodeHandles = memo(function NodeHandles({ connectable = true }: { connectable?: boolean }) {
  return (
    <>
      <Handle type="source" position={Position.Top} id="top" className="cc-handle" isConnectable={connectable} />
      <Handle type="source" position={Position.Right} id="right" className="cc-handle" isConnectable={connectable} />
      <Handle type="source" position={Position.Bottom} id="bottom" className="cc-handle" isConnectable={connectable} />
      <Handle type="source" position={Position.Left} id="left" className="cc-handle" isConnectable={connectable} />
    </>
  );
});
