import { promises as fs } from "node:fs";
import path from "node:path";
import type { ReadinessSubmission, ScoringResult } from "../shared/readiness.ts";

export interface StoredReadinessSubmission {
  id: string;
  timestamp: string;
  submission: ReadinessSubmission;
  scoringResult: ScoringResult;
  userAgent?: string;
  ip?: string;
}

const storagePath =
  process.env.READINESS_STORAGE_PATH ||
  path.join("/tmp", "truckonomics-readiness-submissions.json");

async function readAll(): Promise<StoredReadinessSubmission[]> {
  try {
    const content = await fs.readFile(storagePath, "utf-8");
    return JSON.parse(content) as StoredReadinessSubmission[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveReadinessSubmission(
  entry: StoredReadinessSubmission,
): Promise<void> {
  const all = await readAll();
  all.push(entry);
  await fs.writeFile(storagePath, JSON.stringify(all, null, 2), "utf-8");
}

export async function getReadinessSubmissions() {
  return readAll();
}
