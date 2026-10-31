// Show saved scenes for reference without changing the reader's page or progress.
import type {Story} from '@/lib/content';

export default function StorySceneList({story,page}:{story:Story;page:number}) {
 return <ol className="yu-scene-list" aria-label="分镜列表">
  {story.pages.map((scene,index)=><li key={index} aria-current={index===page?'location':undefined}>
   {scene.image?<img src={scene.image} alt="" loading="lazy"/>:<div className="yu-scene-list-pending">待绘制</div>}
   <div><h3>第 {index+1} 幅{index===page&&<span>正在阅读</span>}</h3><p>{scene.caption||'这幅的旁白尚未保存。'}</p></div>
  </li>)}
 </ol>;
}
