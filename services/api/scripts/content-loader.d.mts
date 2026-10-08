/** Types for W2-H A's shared loader module. */
export interface Problem {
  code: string;
  line: number;
  detail: string;
}
export interface Target {
  url: string;
  apiKey: string;
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
}
export declare const splitHeader: (text: string) => {
  header: Record<string, { value: string; line: number }>;
  body: string;
  bodyStartLine: number;
  problems: Problem[];
};
export declare const isExample: (title: string) => boolean;
export declare const formatProblems: (problems: Problem[]) => string;
