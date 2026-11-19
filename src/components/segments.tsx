import type { Segment } from "@/lib/search";

/** Highlighted text: segments are rendered as React text, so page content can never become markup. */
export function Segments({ segs }: { segs: Segment[] }) {
  return <>{segs.map((s, i) => (s.hit ? <mark key={i}>{s.t}</mark> : <span key={i}>{s.t}</span>))}</>;
}
