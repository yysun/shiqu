// Keep public credits outside generation inputs and distinguish new contributions from source licenses.
import {z} from 'zod';
import type {Story} from './content';

const line=(max:number)=>z.string().trim().max(max).refine(value=>!/[\r\n\t]/.test(value),'请写在一行内。');
export const watermarkFontSize={min:12,max:48,default:24};
export const publicationSchema=z.object({
 author:line(80),workUrl:line(1000).refine(value=>{if(!value)return true;try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}},'作品链接请使用不含账号密码的 http/https 地址。'),
 contact:line(200),sourceNote:z.string().trim().max(1200),reuse:z.string().trim().max(1200),
 // Optional for historical snapshots: parsing an old CAS expectation must not add new fields.
 watermarkFontSize:z.number().int('水印字号请使用整数。').min(watermarkFontSize.min,'水印字号不能小于 12 px。').max(watermarkFontSize.max,'水印字号不能大于 48 px。').optional(),
}).strict();
export type StoryPublication=z.infer<typeof publicationSchema>;
export type PublicationStory=Pick<Story,'publication'>&{generated?:boolean};
export const emptyPublication:StoryPublication={author:'',workUrl:'',contact:'',sourceNote:'',reuse:''};
export function hasPublicationAuthor(publication?:StoryPublication|null){const author=publication?.author.trim();return !!author&&author!=='未署名';}
// Resolve display/export credits without rewriting snapshots; explicit fields win and samples keep their credits.
export function withPublicationDefaults(story:Story,defaults:StoryPublication|null):Story{
 if(!('generated'in story&&story.generated===true)||!defaults)return story;
 const publication={...(story.publication||emptyPublication)};
 for(const field of ['author','workUrl','contact','sourceNote','reuse'] as const){
  if((!publication[field].trim()||field==='author'&&!hasPublicationAuthor(publication))&&defaults[field])publication[field]=defaults[field];
 }
 if(publication.watermarkFontSize===undefined&&defaults.watermarkFontSize!==undefined)publication.watermarkFontSize=defaults.watermarkFontSize;
 return {...story,publication};
}
export const rightsBoundary='代码开源许可不自动适用于作品内容。原作及来源版本遵循各自适用的权利和许可；本次改编中的受保护贡献，除另有许可或法律允许外，再使用请联系相应权利人。制作人的说明不能收紧公版材料或已有许可赋予的权利。';
export function generationModelNames(models:readonly {step:string;model:string}[]|undefined,kind:'text'|'image'){
 const image=kind==='image';
 return [...new Set((models||[]).filter(item=>item.step.startsWith('image:')===image).map(item=>item.model.trim()).filter(Boolean))];
}
export function generationImageModelForPage(models:readonly {step:string;model:string}[]|undefined,page:number){
 const step=`image:${page}`;
 return [...(models||[])].reverse().find(item=>item.step===step&&item.model.trim())?.model.trim()||null;
}
export function aiDisclosure(story:PublicationStory){return 'generated'in story&&story.generated===true?'本作品包含 AI 生成的画面与改编文字。':'创作方式请以制作人说明为准。';}
export function publicationCredit(story:PublicationStory){return `制作：${story.publication?.author||'未署名'} · 拾趣`+('generated'in story&&story.generated===true?' · AI 生成':'');}
export function publicationText(story:PublicationStory){
 const p=story.publication||emptyPublication;
 return [publicationCredit(story),aiDisclosure(story),p.workUrl&&`作品链接：${p.workUrl}`,p.contact&&`联系：${p.contact}`,`来源与许可：${p.sourceNote||'请核对原作出处及实际使用版本的许可。'}`,`转载与再使用：${p.reuse||'未另行提供授权；请先核对来源许可，必要时联系相应权利人。'}`,rightsBoundary].filter(Boolean).join('\n\n');
}
// Include all rendered content so a late export or later metadata edit cannot reuse stale bytes.
export function storyExportKey(story:Story){return JSON.stringify(story);}
