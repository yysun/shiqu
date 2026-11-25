// OpenAI strict JSON Schema 将所有可选字段改为可空的必填字段。
export function strictOpenAISchema(input:unknown):any{
 if(!input||typeof input!=='object')return input;
 if(Array.isArray(input))return input.map(strictOpenAISchema);
 const value=input as Record<string,any>,output=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,strictOpenAISchema(item)]));
 if(value.type==='object'&&value.properties){
  const required=new Set(value.required||[]);
  output.properties=Object.fromEntries(Object.entries(value.properties).map(([key,schema])=>[key,required.has(key)?strictOpenAISchema(schema):{anyOf:[strictOpenAISchema(schema),{type:'null'}]}]));
  output.required=Object.keys(value.properties);output.additionalProperties=false;
 }
 return output;
}
