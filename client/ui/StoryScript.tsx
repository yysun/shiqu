// Reuse saved script content in both the inline disclosure and the reader's standard sheet.
import type {Story} from '@/lib/content';

export default function StoryScript({story,standalone=false}:{story:Story;standalone?:boolean}) {
 const content=<div className="yu-script-content">
   <h3>{story.title}</h3>
   {story.summary&&<p className="yu-script-intro">{story.summary}</p>}
   {story.pages.length?story.pages.map((scene,index)=><section className="yu-script-scene" key={index} aria-label={`第 ${index+1} 幅剧本`}>
    <h4>第 {index+1} 幅</h4>
    <p>{scene.caption||'这幅的旁白尚未保存。'}</p>
    <details className="yu-script-prompt"><summary>画面提示词</summary><p>{scene.prompt||'这幅未保存画面提示词。'}</p></details>
   </section>):<p>这篇故事还没有保存分镜剧本。</p>}
   {story.reflection&&<section className="yu-script-scene"><h4>余味</h4><p>{story.reflection}</p></section>}
   {story.adaptationNote&&<details className="yu-script-prompt"><summary>改编说明</summary><p>{story.adaptationNote}</p></details>}
  </div>;
 return standalone?content:<details className="yu-story-script"><summary>查看剧本 <span>{story.pages.length} 幅分镜</span></summary>{content}</details>;
}
