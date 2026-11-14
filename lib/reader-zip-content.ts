// Share archive names, public fields and text serialization between browser downloads and collection exports.
// Browser code owns image encoding; the collection command keeps those signed WebP bytes unchanged.
import {strToU8} from 'fflate';
import type {Story} from './content';
import type {GeneratedStory} from './reader-model';
import type {StoryPromptHistory} from './reader-prompt-records.ts';
import {pdfFilename,storySourceReference} from './reader-pdf.ts';
import {aiDisclosure,publicationText,emptyPublication,publicationSchema} from './story-publication.ts';
import type {StoryPublication} from './story-publication.ts';
import type {StoryImageHashes} from './story-webp-metadata.ts';
import type {ImportedSourceDisclosure} from './reader-source-types.ts';
import {z} from 'zod';

export type StoryZipData={
 id:string;title:string;summary:string;bookId:string;theme:string;sourceReference:string;sourceText:string;sourceUrl:string;
 artStyleLabel:string|null;author:string;publication:StoryPublication|null;aiGenerated:boolean|null;aiDisclosure:string;
 generationModels:{step:string;model:string}[];pages:({caption:string;prompt?:string|null;image:string}&StoryImageHashes)[];
 reflection:string;adaptationNote:string;revision:number;createdAt:string;updatedAt:string;
 productionPrompt?:string|null;acceptancePrompt?:string|null;promptHistoryFile?:string;importedSourceDisclosure?:ImportedSourceDisclosure|null;
};
export type {ImportedSourceDisclosure} from './reader-source-types.ts';
const importedSourceDisclosureSchema=z.object({sourceNote:z.string().max(1000),license:z.string().max(1000),sources:z.array(z.object({originalName:z.string().min(1).max(255),sourceUrl:z.string().url().optional()}).strict()).max(100)}).strict();
export function normalizeImportedSourceDisclosure(value:unknown){
 const manifest=z.object({sourceNote:z.string().max(1000),license:z.string().max(1000),sources:z.array(z.object({originalName:z.string().min(1).max(255),sourceUrl:z.string().url().optional()}).passthrough()).max(100)}).passthrough().parse(value);
 return importedSourceDisclosureSchema.parse({sourceNote:manifest.sourceNote,license:manifest.license,sources:manifest.sources.map(({originalName,sourceUrl})=>({originalName,...(sourceUrl?{sourceUrl}:{})}))});
}
const publicFields=['id','title','summary','bookId','theme','sourceReference','sourceText','sourceUrl','artStyleLabel','author','publication','aiGenerated','aiDisclosure','generationModels','pages','reflection','adaptationNote','revision','createdAt','updatedAt'] as const;
const publicPublication=publicationSchema.omit({watermarkFontSize:true}).strip();
export function zipFilename(title:string){return pdfFilename(title).replace(/-拾趣\.pdf$/,'.zip');}
export function zipImageFilename(index:number,count:number){return `图片/${String(index+1).padStart(Math.max(2,String(count).length),'0')}.webp`;}
export function assertZipReady(story:Pick<Story,'pages'>){
 if(!story.pages.length||story.pages.some(page=>!page.image))throw Error('等所有画面生成完成后，就能下载分镜与图片 ZIP。');
}
export function zipMetadataStory(data:StoryZipData){
 return {...data,generated:data.aiGenerated===true,publication:data.publication||{...emptyPublication,author:data.author}};
}
export function storyZipData(story:Story,images:string[],hashes:StoryImageHashes[],history:StoryPromptHistory|null,importedSourceDisclosure?:ImportedSourceDisclosure):StoryZipData{
 const generated='generated'in story&&story.generated===true?story as GeneratedStory:null;
 return {
  id:story.id,title:story.title,summary:story.summary,bookId:story.bookId,theme:story.theme,
  sourceReference:storySourceReference(story),sourceText:story.sourceText,sourceUrl:story.sourceUrl,
  artStyleLabel:generated?.artStyleLabel??null,author:story.publication?.author||'',publication:story.publication||null,
  aiGenerated:generated?true:null,aiDisclosure:aiDisclosure(story),generationModels:generated?.generationModels??[],
  productionPrompt:history?.productionPrompt??null,acceptancePrompt:history?.acceptancePrompt??null,promptHistoryFile:'提示词.json',...((importedSourceDisclosure||generated?.original?.importedSourceDisclosure)?{importedSourceDisclosure:importedSourceDisclosure||generated!.original!.importedSourceDisclosure}:{}),
  pages:story.pages.map((page,index)=>({caption:page.caption,prompt:page.prompt||null,image:images[index],...hashes[index]})),
  reflection:story.reflection,adaptationNote:story.adaptationNote,revision:story.revision,createdAt:story.createdAt,updatedAt:story.updatedAt,
 };
}
export function publicStoryZipData(input:StoryZipData):StoryZipData{
 for(const key of publicFields)if(!Object.hasOwn(input,key))throw Error(`故事.json 缺少公开字段：${key}`);
 if(input.publication&&input.publication.author!==input.author)throw Error('公开制作署名不符。');
 if(input.aiDisclosure!==aiDisclosure(zipMetadataStory(input)))throw Error('公开 AI 披露与创作方式不符。');
 return {
  ...Object.fromEntries(publicFields.map(key=>[key,input[key]])) as StoryZipData,
  ...(input.importedSourceDisclosure?{importedSourceDisclosure:importedSourceDisclosureSchema.parse(input.importedSourceDisclosure)}:{}),
  publication:input.publication===null?null:publicPublication.parse(input.publication),
  generationModels:input.generationModels.map(({step,model})=>({step,model})),
  pages:input.pages.map(({caption,image,sha256,originalSha256,imagePayloadSha256})=>({caption,image,sha256,originalSha256,imagePayloadSha256})),
 };
}
export function storyZipFiles(data:StoryZipData,{includePrompts=true,sourceDisclosure}:{includePrompts?:boolean;sourceDisclosure?:ImportedSourceDisclosure}={}):Record<string,Uint8Array>{
 const story=includePrompts?data:publicStoryZipData(data),credits=publicationText(zipMetadataStory(story));
 const disclosure=sourceDisclosure||story.importedSourceDisclosure||undefined,importedCredits=disclosure?['原文为用户导入，保存在用户本地书库。',disclosure.sources.length&&`原文来源：${disclosure.sources.map(source=>source.sourceUrl||source.originalName).join('；')}`,disclosure.sourceNote&&`来源说明：${disclosure.sourceNote}`,disclosure.license&&`授权说明：${disclosure.license}`].filter(Boolean).join('\n\n'):'';
 const fullCredits=[credits,importedCredits].filter(Boolean).join('\n\n');
 const markdown=[
  `# ${story.title}`,story.summary,`主题：${story.theme}`,`出处：${story.sourceReference}`,
  story.sourceUrl&&`出处链接：${story.sourceUrl}`,story.artStyleLabel&&`画风：${story.artStyleLabel}`,
  `## 署名与转载\n\n${fullCredits}`,
  ...story.pages.map((page,index)=>`## 第 ${index+1} 幅\n\n图片：${page.image}\n\n### 旁白\n\n${page.caption}`+(includePrompts?`\n\n### 画面提示词\n\n${page.prompt||'未留存。'}`:'')),
  story.reflection&&`## 余味\n\n${story.reflection}`,story.adaptationNote&&`## 改编说明\n\n${story.adaptationNote}`,
  story.sourceText&&`## 保存的原文\n\n${story.sourceText}`,
 ].filter(Boolean).join('\n\n')+'\n';
 return {
  '分镜.md':strToU8(markdown),
  '故事.json':strToU8(JSON.stringify(story,null,2)+'\n'),
  '署名与转载.txt':strToU8(`${story.title}\n\n${fullCredits}\n\n原作出处：${story.sourceReference}\n${story.sourceUrl}\n\n作品编号：${story.id}\n版本：${story.revision}\n保存时间：${story.updatedAt}\n`),
 };
}
