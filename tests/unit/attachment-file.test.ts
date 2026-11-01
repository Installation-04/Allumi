import { expect,it } from "vitest";
import { inspectFile,MAX_ATTACHMENT_BYTES } from "@/modules/attachments/domain/file";
it("refuses empty, oversized, active and mismatched formats",()=>{
 for(const [name,bytes] of [["empty.pdf",new Uint8Array()],["large.png",new Uint8Array(MAX_ATTACHMENT_BYTES+1)],["file.svg",Buffer.from('<svg onload="x"/>')],["file.pdf",Buffer.from('<script>bad</script>')]] as const) expect(inspectFile(name,bytes)).toBeNull();
 expect(inspectFile("receipt.pdf",Buffer.from("%PDF-1.4\n%%EOF"))?.mime).toBe("application/pdf");
 expect(inspectFile("../../réçu\n.pdf",Buffer.from("%PDF-1.4\n%%EOF"))?.name).not.toMatch(/[\/\n]/);
 expect(inspectFile("receipt.html",Buffer.from("%PDF-1.4\n%%EOF"))).toBeNull();
});
