// Minimal ambient types for the hand-run developer script fm-segment-parse.mjs.
// It ships as plain ESM with no types of its own; this file exists only so
// tsc (tsconfig.tests.json) can type-check the tests that import it, without
// tsc inferring types from the .mjs source itself. Every export below is
// intentionally `any`-typed.
export declare const NON_DISPLAY_KEYS: Set<string>;
export declare const MASK_PATTERN: RegExp;
export declare const RENDER_KINDS: any[];
export declare function slotID(member: any, number?: any): any;
export declare function parseSlotID(key: any): any;
export declare function expandSlots(step: any): any;
export declare function displayKeys(step: any): any;
export declare function labelCandidates(key: any): any;
export declare function isRepetitionKey(key: any): any;
export declare function repetitionBracket(value: any): any;
export declare function isSetValue(value: any): any;
export declare function matchSegments(step: any, line: any, displayName: any): any;
export declare function bracketContent(line: any, displayName: any): any;
