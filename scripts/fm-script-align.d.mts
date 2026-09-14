// Minimal ambient types for the hand-run developer script fm-script-align.mjs.
// It ships as plain ESM with no types of its own; this file exists only so
// tsc (tsconfig.tests.json) can type-check the tests that import it, without
// tsc inferring narrow literal types from the .mjs source itself (which
// produced spurious "no index signature" errors when a name was indexed
// with a plain `string`). Every export below is intentionally `any`-typed.
export declare const DISPLAY_NAME_OVERRIDES: Record<string, any>;
export declare const NAME_UNVERIFIABLE: Set<string>;
export declare function oneLine(value: any): any;
export declare function normaliseCalc(value: any): any;
export declare function alignSteps(body: any, lines: any, displayNameFor: any): any;
