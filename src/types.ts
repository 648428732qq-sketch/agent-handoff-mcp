export interface HandoffThread {
  topic: string;
  updated: string;
  sourceAgent: string;
  project: string | null;
  workspace: string | null;
  summary: string;
  goal: string;
  progress: string;
  decisions: string;
  nextSteps: string;
}

export interface HandoffIndexEntry {
  topic: string;
  project: string | null;
  sourceAgent: string;
  updated: string;
  summary: string;
  filePath: string;
}

export interface SaveHandoffInput {
  topic: string;
  goal: string;
  progress: string;
  decisions?: string;
  nextSteps: string;
  summary?: string;
  sourceAgent?: string;
  project?: string | null;
  workspace?: string | null;
}

export interface CloseHandoffResult {
  topic: string;
  removedFile: string;
  archivedFile?: string;
}

/**
 * Storage abstraction so local Markdown is the default zero-server backend,
 * while future remote/cloud backends can implement the exact same interface.
 */
export interface HandoffStore {
  readonly baseDir: string;
  list(project?: string): Promise<HandoffIndexEntry[]>;
  load(topic: string): Promise<{ entry: HandoffIndexEntry; content: string } | null>;
  save(input: SaveHandoffInput): Promise<HandoffIndexEntry>;
  close(topic: string, archiveDir?: string): Promise<CloseHandoffResult | null>;
  exportPrompt(topic: string): Promise<string | null>;
}
