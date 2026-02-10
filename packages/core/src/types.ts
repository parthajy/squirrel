export type MemoryType = "note" | "task" | "idea" | "reference" | "receipt" | "conversation";

export type ClawDecision =
  | { intent: "ignore"; should_reply: false; reply_text: "" }
  | {
      intent: "clarify";
      should_reply: true;
      reply_text: string;
      confidence: number;
    }
  | {
      intent: "store";
      memory_type: MemoryType;
      title: string;
      summary: string;
      raw_text_hint?: string | null;
      tags: string[];
      entities: string[];
      task?: { assignee?: string | null; deadline?: string | null; next_step?: string | null; status?: string | null };
      confidence: number;
      should_reply: boolean;
      reply_text: string;
    }
  | {
      intent: "query";
      query: string;
      query_intent: "find" | "summarize" | "timeline" | "compare" | "decision" | "task_status";
      must_retrieve: true;
      confidence: number;
      should_reply: true;
      reply_text: "";
    };
