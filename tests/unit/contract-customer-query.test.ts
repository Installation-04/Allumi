import { expect, it } from 'vitest';
import { contractCustomerQuery } from '@/modules/contracts/client';
it('keeps literal Unicode searches and rejects empty, short, repeated, long or control-bearing input',()=>{
 expect(contractCustomerQuery('  %_\\  ')).toBe('%_\\');expect(contractCustomerQuery('ÉTÉ')).toBe('ÉTÉ');expect(contractCustomerQuery('🪷'.repeat(100))).toHaveLength(200);
 for(const value of [undefined,null,['ab','cd'],'','x','  ','\nAlice','Alice\t','a'.repeat(101),'🪷'.repeat(101)])expect(()=>contractCustomerQuery(value)).toThrow(RangeError);
});
