// Class names of the data tables. A plain module on purpose: a constant exported from a "use client" file is a
// client reference on the server, and interpolating it into a class name would print the reference, not the string.
export const TABLE_CLASS = "w-full border-collapse text-sm";
export const TH_CLASS = "border-b border-stone-300 px-2 py-2 text-left font-semibold dark:border-stone-700";
export const TD_CLASS = "border-b border-stone-200 px-2 py-2 align-top dark:border-stone-800";
