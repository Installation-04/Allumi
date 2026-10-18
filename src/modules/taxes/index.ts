// Public API of the taxes module for server code. Client components import "@/modules/taxes/client".
export * from "./domain/compute";
export * from "./domain/decimal";
export * from "./domain/lines";
export * from "./domain/rates";
export * from "./domain/schemas";
export * from "./domain/starter";

export {
  addTaxRate,
  createTax,
  createTaxCode,
  getTax,
  installQuebecTaxes,
  listTaxCodes,
  listTaxes,
  updateTax,
  updateTaxCode,
  type RateDto,
  type TaxCodeDto,
  type TaxDto,
} from "./service/taxes";
