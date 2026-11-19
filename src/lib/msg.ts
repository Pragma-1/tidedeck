/** Marks a string as translatable without translating it yet (picked up by the i18n completeness test). */
export const msg = <T extends string>(s: T): T => s;
