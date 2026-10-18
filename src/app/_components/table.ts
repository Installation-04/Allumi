// Class names of the data tables. A plain module on purpose: a constant exported from a "use client" file is a
// client reference on the server, and interpolating it into a class name would print the reference, not the string.
export const TABLE_CLASS = "w-full min-w-[40rem] border-collapse text-sm";
export const TH_CLASS = "border-b border-stone-300 px-4 py-3 text-left font-semibold dark:border-stone-700";
export const TD_CLASS = "border-b border-stone-200 px-4 py-3 align-top dark:border-stone-800";
