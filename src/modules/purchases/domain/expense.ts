import { z } from "zod";
import { draftSchema } from "./draft";
import { PAYMENT_METHODS } from "@/modules/payments/client";
export const expenseSchema = z.object(draftSchema.shape).omit({ dueDate: true }).extend({ paymentAccountId: z.uuid(), paymentMethod: z.enum(PAYMENT_METHODS) });
