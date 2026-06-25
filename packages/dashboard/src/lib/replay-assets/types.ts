/**
 * Minimal local types for the rrweb serialized-node shape we walk for asset
 * URLs. We intentionally do NOT import rrweb's own types: rrweb 2.0-alpha ships
 * inconsistent type exports across sub-packages (see the cast in
 * packages/tracker/src/replay.ts), and the serialized format is stable enough
 * that a narrow local shape is more robust than coupling to those exports.
 *
 * rrweb-snapshot node types: 0 Document, 1 DocumentType, 2 Element, 3 Text,
 * 4 CDATA, 5 Comment. We only care about Element (attributes) and Text
 * (CSS text inside <style>).
 */

export const NODE_TYPE_ELEMENT = 2;
export const NODE_TYPE_TEXT = 3;

export interface SerializedNode {
  type?: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
  textContent?: string;
  // rrweb stores inlined stylesheet text here when inlineStylesheet is on.
  isStyle?: boolean;
  [key: string]: unknown;
}

/** An rrweb event with time. We only narrow the fields we touch. */
export interface RrwebEvent {
  type?: number;
  data?: {
    // FullSnapshot (event type 2)
    node?: SerializedNode;
    // IncrementalSnapshot (event type 3) mutation (source 0)
    source?: number;
    adds?: Array<{ node?: SerializedNode; parentId?: number; nextId?: number | null }>;
    attributes?: Array<{ id?: number; attributes?: Record<string, unknown> }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** rrweb event type constants we dispatch on. */
export const EVENT_TYPE_FULL_SNAPSHOT = 2;
export const EVENT_TYPE_INCREMENTAL = 3;
/** IncrementalSource.Mutation */
export const INCREMENTAL_SOURCE_MUTATION = 0;
