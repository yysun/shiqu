// Select a saved scene while preserving the reader's normal navigation and progress handling.
import type {Story} from '@/lib/content';

export default function StorySceneList({story,page,onSelect}:{story:Story;page:number;onSelect:(page:number)=>void}) {
 return <ol className="yu-scene-list" aria-label="分镜列表">
  {story.pages.map((scene,index)=><li key={index}>
   <button type="button" onClick={()=>onSelect(index)} aria-label={`跳转到第 ${index+1} 幅`} aria-current={index===page?'location':undefined}>
    {scene.image?<img src={scene.image} alt="" loading="lazy"/>:<span className="yu-scene-list-pending">待绘制</span>}
    <span className="yu-scene-list-copy"><strong className="yu-scene-list-heading">第 {index+1} 幅{index===page&&<span>正在阅读</span>}</strong><span className="yu-scene-list-caption">{scene.caption||'这幅的旁白尚未保存。'}</span></span>
   </button>
  </li>)}
 </ol>;
}
