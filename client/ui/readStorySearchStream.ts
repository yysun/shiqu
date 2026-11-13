// 读取故事检索的逐行进度和结果。
export async function readStorySearchStream(response:Response,onEvent:(event:any)=>void){
 if(!response.ok){let data:any={};try{data=await response.json();}catch{}throw Error(data.error||'检索暂时失败，请重试。');}
 if(!response.body)throw Error('浏览器无法读取检索进度。');
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
 while(true){const {done,value}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines)if(line.trim())onEvent(JSON.parse(line));if(done)break;}
}
