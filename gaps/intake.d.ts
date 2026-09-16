/** Types `fm-adt-toolkit/intake`, which resolves to `gaps/intake.json` itself rather than to
 *  anything compiled -- the record is data, and `check` writes it. Node requires the import
 *  attribute on a JSON module:
 *
 *      import intake from 'fm-adt-toolkit/intake' with { type: 'json' };
 *
 *  The same shape is available as the `Intake` type from `fm-adt-toolkit/gaps`, for code
 *  already importing the register. */
declare const intake: {
  /** The fm CLI's `--version` the measurements were taken with, e.g. `0.7.0`. */
  version: string;
  /** The build number from that banner, e.g. `29823677`. */
  build: string;
  /** The date of the `check` run that recorded it, `YYYY-MM-DD`. */
  checked: string;
};
export default intake;
