/** One NDJSON operation line. */
export interface AdtOp {
  op: string;
  [key: string]: unknown;
}

export interface AdtOpError {
  code: string;
  message: string;
  /** One entry per problem. `path` is a JSON Pointer into the body we sent. */
  details?: Array<{ code: string; path?: string; message: string; token?: string }>;
  dbError?: number;
}

export interface AdtOpResult {
  op: string;
  status: 'ok' | 'dry-run' | 'error';
  result?: Record<string, unknown>;
  error?: AdtOpError;
}

export interface AdtSummary {
  total: number;
  ok: number;
  errors: number;
  dryRun: boolean;
  rolledBack: boolean;
}

/** A non-result informational line, e.g. {"type":"credential","action":"prompted"}. */
export interface AdtNotice {
  type: string;
  [key: string]: unknown;
}

/** The run-level failure the CLI reports instead of op results.
 *
 *  Emitted as {"type":"fatal","error":{…}} on stderr with no results at all —
 *  a target it cannot open, a run that timed out. Verified against fm 0.6.0:
 *  a missing --file exits 2 with stdout empty and this line on stderr. Its
 *  `suggestions` are the CLI's own actionable advice, so they are surfaced
 *  verbatim rather than paraphrased.
 */
export interface AdtFatal {
  code: string;
  message: string;
  suggestions?: string[];
  dbError?: number;
}

export interface AdtRunResult {
  ok: boolean;
  exitCode: number;
  results: AdtOpResult[];
  summary: AdtSummary | null;
  notices: AdtNotice[];
  /** Present only when the CLI reported a run-level failure. */
  fatal?: AdtFatal;
  stderr: string;
  /** Raw stdout, or the contents of --out when the run used one. Kept verbatim so
   *  a gap register entry can record exactly what the CLI said. */
  stdout: string;
  /** The exact argv the runner passed after the binary path. */
  argv: string[];
}

/** The file and account a run opens. Never a password. */
export interface FmTarget {
  file: string;
  username: string;
}

/** One step of a described script's body, as the CLI reports it.
 *
 *  `name` and `target` are called out because the insert-position picker names a
 *  step by them — Set Variable carries its variable in `name`, Insert from URL
 *  its destination in `target`. Every other key a step type has (value, flags,
 *  cURL options…) comes through the index signature untouched. */
export interface ScriptDetailStep {
  stepID: number;
  step: string;
  /** Absent on a script read from a file written before FileMaker recorded them. */
  uuid?: string;
  name?: string;
  target?: string;
  [key: string]: unknown;
}
