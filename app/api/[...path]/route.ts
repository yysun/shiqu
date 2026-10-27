import {api} from '@/lib/server';
export const dynamic='force-dynamic';
async function handle(req:Request,ctx:{params:Promise<{path:string[]}>}){return api(req,(await ctx.params).path);}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE};
