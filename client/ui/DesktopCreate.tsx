// 桌面新建页：左侧是发现页的书、心情与“不挑了”，右侧是内联的新建表单（与手机面板同一个组件、同一份属性）。
// ≥1024px 左右并排，以下上下堆叠（选择在上、表单在下）。点选书或心情由 Reader 的 choose() 处理，
// 它会递增表单的 key 并清除保留的草稿，使表单按新选择重新初始化；表单自己的选书不重新挂载。
import type {ReactNode} from 'react';

export default function DesktopCreate({choices,form}:{choices:ReactNode;form:ReactNode}){
 return <div className="yu-create">
  <section className="yu-create-choices" aria-label="从书或心情开始">{choices}</section>
  <section className="yu-create-form" aria-labelledby="desktop-create-title"><h1 id="desktop-create-title">这一篇，想怎样读？</h1>{form}</section>
 </div>;
}
