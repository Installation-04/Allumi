import { expect, it } from "vitest";
import { documentStage, documentLinkState } from "@/modules/contracts/client";
it('keeps a recorded signature independent from an expired, revoked or unavailable link', () => {
 const now=new Date('2026-06-01T12:00:00Z'),d={status:'PUBLISHED',firstViewedAt:now,signedAt:now,revokedAt:null,expiresAt:now};
 expect(documentStage(d)).toBe('SIGNED');expect(documentLinkState(d,true,now)).toBe('EXPIRED');expect(documentLinkState({...d,revokedAt:now},false,now)).toBe('REVOKED');expect(documentLinkState({...d,expiresAt:new Date(now.getTime()+1)},false,now)).toBe('SOURCE_UNAVAILABLE');
 expect(documentStage({...d,signedAt:null})).toBe('VIEWED');expect(documentStage({...d,signedAt:null,firstViewedAt:null})).toBe('PUBLISHED');expect(documentLinkState({...d,status:'DRAFT'},false,now)).toBe('DRAFT');
});
