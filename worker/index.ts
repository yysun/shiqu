import handler from 'vinext/server/fetch-handler';

// This exported edition is for one person's localhost Docker instance.
// Discard caller-supplied identity; do not expose this edition as a public service.
export default {
 fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
  const headers=new Headers(request.headers);
  headers.delete('oai-authenticated-user-id');
  headers.set('oai-authenticated-user-id','docker-local-owner');
  const localRequest=new Request(request,{headers});
  return handler.fetch(localRequest,env,ctx);
 },
};
