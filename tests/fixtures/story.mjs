// Synthetic records for validation/export/persistence tests; never shipped or inserted automatically.
export function makeStory(count=10){return {id:'test-story',title:'测试故事',summary:'测试人物经历变故、采取行动，故事在实际结果处结束。',bookId:'zhuangzi',theme:'人情冷暖',status:'published',pages:Array.from({length:count},(_,i)=>({caption:'测试旁白'+i,prompt:'A test scene '+i,image:'/api/media/test-'+i+'.png',audio:''})),reflection:'测试余味',sourceText:'用于测试的原文片段。',sourceUrl:'https://example.org/source',adaptationNote:'测试改编说明',checks:{source:true,plot:true,visual:true},revision:1,createdAt:'2026-10-29T00:00:00Z',updatedAt:'2026-10-29T00:00:00Z'};}

// Seed a completed current-workflow checkpoint without inference; lifecycle tests use the same APIs as desktop.
export async function insertReaderStory(app,story=makeStory()){
 const id=/^[a-f0-9-]{36}$/.test(story.id)?story.id:crypto.randomUUID();
 const original={title:'测试原文',text:story.sourceText,url:story.sourceUrl,kind:'passage',provider:'fixture',retrievedAt:story.createdAt};
 const plan={title:story.title,summary:story.summary,reflection:story.reflection,sourceReference:original.title,adaptationNote:story.adaptationNote,characters:'测试人物有清楚而稳定的外貌、服装与时代特征。',pages:story.pages.map(({caption,prompt})=>({caption,prompt}))};
 const document={plan,original,frameCountConfirmed:true,images:story.pages.map(page=>page.image),audio:story.pages.map(page=>page.audio),usage:[]};
 const selection={bookId:story.bookId,theme:story.theme,artStyle:'ink-pencil',length:story.pages.length,voice:false,productionPrompt:''};
 await app.services.database.prepare("INSERT INTO stories(id,user_id,selection,document,generation_control,production_complete,created_at,updated_at) VALUES(?,?,?,?,'stopped',1,?,?)")
  .bind(id,'docker-local-owner',JSON.stringify(selection),JSON.stringify(document),story.createdAt,story.updatedAt).run();
 return {...story,id};
}
