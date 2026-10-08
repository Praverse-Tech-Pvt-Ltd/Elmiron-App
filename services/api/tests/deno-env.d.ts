/**
 * W2-H C — `stub-provider.spec.ts` imports the Edge Function's stub, which reads `Deno.env` inside
 * `createStubProvider`. Node has no `Deno`; the spec stands one in at run time, and this declares
 * exactly the slice the stub touches so the file typechecks here. Nothing else in the tests uses it.
 */
declare const Deno: { env: { get(key: string): string | undefined } };
